// services/brand-engine/src/analyze/cli.js
//
// analyze | plan | verify | evidence assemble
//
// Exit codes:
//   0  done (verify: improved, or no change)
//   1  verify only: regressions, or a claimed task that did not land
//   2  invalid input (usage, a malformed file or report, an unknown profile)
//   3  refused (invalid brand data, a modified rubric or document, an
//      analysis that cannot be compared, a verify that proves nothing)
//
// The engine reads the checkout and the report files it is given. It never
// runs git or any external tool, never uses the network, and reads no
// environment variable, so no secret can reach an output. The only files it
// writes are those named by --out and -o, and never inside the checkout.
import { existsSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../json.js';
import { defaultBrandDir, loadBrandDir, lookupProfile } from '../registry.js';
import { EXIT, EvidenceError, Refused } from '../score/constants.js';
import { latestRubricRef, loadRubric } from '../score/rubric.js';
import { scoreSchema } from '../score/schemas.js';
import { AdapterError } from './adapters/common.js';
import { parseAssessments, parseObserved } from './adapters/manual.js';
import { AnalyzeError, analyze, DEFAULT_THEMES } from './analyze.js';
import { AssembleError, assemble } from './assemble.js';
import { DocError, readBounded, readEngineDocument } from './docs.js';
import { plan } from './plan.js';
import { DEFAULT_CHECKS_DIR } from './registry.js';
import { renderAnalysis, renderPlan, renderVerification } from './render.js';
import { sha256Hex } from '../score/util.js';
import { VerifyRefused, verify } from './verify.js';

export const WORKFLOW_COMMANDS = ['analyze', 'plan', 'verify', 'evidence'];

export const WORKFLOW_USAGE = [
  'usage: brand-engine analyze <path> [--profile <id|file>] [--reports <dir>] [--out <dir>] [--repo <owner/name>] [--commit <sha>] [--themes light,dark] [--rubric bxqs-1.0.0] [--brand-dir <dir>]',
  '       brand-engine plan <analysis.json> [--out <dir>] [--brand-dir <dir>]',
  '       brand-engine verify --before <analysis.json> <path> [--profile <id|file>] [--reports <dir>] [--plan <plan.json>] [--claimed <T-id,...|all>] [--out <dir>] [--brand-dir <dir>]',
  '       brand-engine evidence assemble --analysis <analysis.json> --built-by <id> [--assessments <file>] [--observed <file>] [--generated-at <date-time>] [--repo <owner/name>] [--commit <sha>] [--assistive-tech true|false] [-o <evidence.json>] [--brand-dir <dir>]',
].join('\n');

const COMMON = ['--profile', '--reports', '--out', '--repo', '--commit', '--themes', '--rubric', '--brand-dir', '--checks-dir', '--timeout-ms'];
const FLAGS = {
  analyze: new Set(COMMON),
  plan: new Set(['--out', '--brand-dir']),
  verify: new Set([...COMMON, '--before', '--plan', '--claimed']),
  assemble: new Set(['--analysis', '--assessments', '--observed', '--built-by', '--generated-at', '--repo', '--commit', '--assistive-tech', '-o', '--brand-dir']),
};

function parse(command, argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('-') && arg.length > 1) {
      if (!FLAGS[command].has(arg)) return { error: `unknown argument ${arg}` };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (Object.hasOwn(flags, arg)) return { error: `${arg} given twice` };
      flags[arg] = value;
      i += 1;
    } else positional.push(arg);
  }
  return { positional, flags };
}

/** True when `child` is `parent` or lies inside it (resolving links in the part that exists). */
function isInside(child, parent) {
  const real = (p) => {
    let probe = resolve(p);
    const tail = [];
    while (!existsSync(probe)) { tail.unshift(probe.slice(dirname(probe).length + 1)); const up = dirname(probe); if (up === probe) break; probe = up; }
    return join(realpathSync(probe), ...tail);
  };
  const c = real(child);
  const p = real(parent);
  return c === p || c.startsWith(p + sep);
}

function writeFileAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

function engineRoot() {
  return fileURLToPath(new URL('../../', import.meta.url));
}

/** Registry, profile and rubric shared by analyze and verify. */
function context(args, { err, profileFallback, rubricRef, root }) {
  const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();
  const reg = loadBrandDir(brandDir);
  if (reg.errors.length) {
    for (const e of reg.errors) err(`${e.file}: ${e.message}`);
    err('refused: brand data is invalid; run `brand-engine profile validate`');
    return { code: EXIT.REFUSED };
  }
  let profileArg = args.flags['--profile'];
  if (profileArg === undefined) {
    const local = join(root, 'brand', 'profile.json');
    profileArg = isFile(local) ? local : profileFallback;
  }
  if (profileArg === undefined) { err(`no profile: pass --profile <id|file>, or keep the product profile at ${join('<path>', 'brand', 'profile.json')}\n${WORKFLOW_USAGE}`); return { code: EXIT.INVALID }; }
  const found = lookupProfile(profileArg, reg);
  if (found.errors.length || !found.resolved) {
    for (const m of found.errors) err(`profile: ${m}`);
    return { code: EXIT.INVALID };
  }
  for (const w of found.warnings) err(`warning: ${w}`);
  const bundle = loadRubric(brandDir, args.flags['--rubric'] ?? rubricRef ?? latestRubricRef(brandDir));
  return { reg, found, bundle, brandDir, profileSource: found.source };
}

function analyzeOptions(args, err) {
  const o = {};
  if (args.flags['--themes'] !== undefined) {
    const themes = args.flags['--themes'].split(',').map((t) => t.trim());
    if (themes.some((t) => !/^[a-z][a-z0-9_-]{0,39}$/.test(t)) || new Set(themes).size !== themes.length) { err('--themes must be a comma-separated list of distinct names such as light,dark'); return null; }
    o.themes = themes;
  }
  if (args.flags['--repo'] !== undefined) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.flags['--repo'])) { err('--repo must look like owner/name'); return null; }
    o.repo = args.flags['--repo'];
  }
  if (args.flags['--commit'] !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(args.flags['--commit'])) { err('--commit must be 40 lowercase hex characters'); return null; }
    o.commit = args.flags['--commit'];
  }
  if (args.flags['--timeout-ms'] !== undefined) {
    const n = Number(args.flags['--timeout-ms']);
    if (!Number.isInteger(n) || n < 100 || n > 600000) { err('--timeout-ms must be an integer from 100 to 600000'); return null; }
    o.timeoutMs = n;
  }
  if (args.flags['--checks-dir'] !== undefined) {
    // Extra check modules are CODE. Only a directory inside the engine's own
    // package may be loaded; a path in the product checkout never is.
    const dir = resolve(args.flags['--checks-dir']);
    if (!isDir(dir) || !isInside(dir, engineRoot())) { err('--checks-dir must be a directory inside the brand-engine package (check modules are code and are never loaded from a product checkout)'); return null; }
    o.checksDir = dir;
  } else o.checksDir = DEFAULT_CHECKS_DIR;
  return o;
}

export async function workflowMain(argv, deps = {}) {
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));
  const invalid = (message) => { err(`${message}\n${WORKFLOW_USAGE}`); return EXIT.INVALID; };

  let command = argv[0];
  let rest = argv.slice(1);
  if (command === 'evidence') {
    if (argv[1] !== 'assemble') return invalid('evidence needs the subcommand assemble');
    command = 'assemble';
    rest = argv.slice(2);
  }
  const args = parse(command, rest);
  if (args.error) return invalid(args.error);

  try {
    // ------------------------------------------------------------ analyze
    if (command === 'analyze') {
      if (args.positional.length !== 1) return invalid('analyze needs exactly one path');
      const root = args.positional[0];
      if (!isDir(root)) { err(`${root} is not a directory`); return EXIT.INVALID; }
      const realRoot = realpathSync(root);
      const outDir = args.flags['--out'];
      if (outDir !== undefined && isInside(outDir, realRoot)) { err('--out must not be inside the checkout: the engine never writes to the product repository'); return EXIT.INVALID; }
      if (args.flags['--reports'] !== undefined && !isDir(args.flags['--reports'])) { err(`--reports ${args.flags['--reports']} is not a directory`); return EXIT.INVALID; }
      const opts = analyzeOptions(args, err);
      if (!opts) return EXIT.INVALID;
      const ctx = context(args, { err, root: realRoot });
      if (ctx.code !== undefined) return ctx.code;

      const analysis = await analyze({
        root: realRoot, profile: ctx.found.resolved, profileInfo: { source: ctx.profileSource }, rubricBundle: ctx.bundle,
        reportsDir: args.flags['--reports'], ...opts,
      });
      const problems = scoreSchema('brand-analysis').validate(analysis);
      if (problems.length) { for (const m of problems.slice(0, 10)) err(`internal: ${m}`); err('refused: the engine produced an analysis that fails its own schema'); return EXIT.REFUSED; }
      const json = `${stableStringify(analysis)}\n`;
      if (outDir === undefined) { out(json.trimEnd()); return EXIT.OK; }
      writeFileAtomic(join(outDir, 'analysis.json'), json);
      const summary = renderAnalysis(analysis);
      writeFileAtomic(join(outDir, 'summary.md'), summary);
      out(summary.trimEnd());
      return EXIT.OK;
    }

    // ------------------------------------------------------------ plan
    if (command === 'plan') {
      if (args.positional.length !== 1) return invalid('plan needs exactly one analysis.json');
      const outDir = args.flags['--out'];
      const analysis = readEngineDocument(args.positional[0], 'brand-analysis', 'analysis');
      const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();
      const reg = loadBrandDir(brandDir);
      if (reg.errors.length) { for (const e of reg.errors) err(`${e.file}: ${e.message}`); err('refused: brand data is invalid; run `brand-engine profile validate`'); return EXIT.REFUSED; }
      const bundle = loadRubric(brandDir, `${analysis.rubric.id}-${analysis.rubric.version}`);
      if (bundle.sha256 !== analysis.rubric.sha256) { err(`refused: the analysis used rubric ${analysis.rubric.id}@${analysis.rubric.version} with a different hash than the one on disk`); return EXIT.REFUSED; }
      const doc = plan(analysis, { rubric: bundle.rubric, principles: reg.principles });
      const problems = scoreSchema('brand-plan').validate(doc);
      if (problems.length) { for (const m of problems.slice(0, 10)) err(`internal: ${m}`); err('refused: the engine produced a plan that fails its own schema'); return EXIT.REFUSED; }
      const json = `${stableStringify(doc)}\n`;
      if (outDir === undefined) { out(json.trimEnd()); return EXIT.OK; }
      writeFileAtomic(join(outDir, 'plan.json'), json);
      const md = renderPlan(doc);
      writeFileAtomic(join(outDir, 'plan.md'), md);
      out(md.trimEnd());
      return EXIT.OK;
    }

    // ------------------------------------------------------------ verify
    if (command === 'verify') {
      const beforePath = args.flags['--before'];
      if (!beforePath) return invalid('verify needs --before <analysis.json>');
      if (args.positional.length !== 1) return invalid('verify needs exactly one path');
      const root = args.positional[0];
      if (!isDir(root)) { err(`${root} is not a directory`); return EXIT.INVALID; }
      const realRoot = realpathSync(root);
      const outDir = args.flags['--out'];
      if (outDir !== undefined && isInside(outDir, realRoot)) { err('--out must not be inside the checkout: the engine never writes to the product repository'); return EXIT.INVALID; }
      if (args.flags['--reports'] !== undefined && !isDir(args.flags['--reports'])) { err(`--reports ${args.flags['--reports']} is not a directory`); return EXIT.INVALID; }

      const before = readEngineDocument(beforePath, 'brand-analysis', 'baseline analysis');
      const planDoc = args.flags['--plan'] ? readEngineDocument(args.flags['--plan'], 'brand-plan', 'plan') : undefined;
      let claimed = new Set();
      let claimAll = false;
      if (args.flags['--claimed'] !== undefined) {
        if (!planDoc) return invalid('--claimed needs --plan');
        if (args.flags['--claimed'] === 'all') claimAll = true;
        else {
          const ids = args.flags['--claimed'].split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length === 0 || ids.some((t) => !/^T-[0-9a-f]{8}$/.test(t))) return invalid('--claimed must be "all" or a comma-separated list of task ids such as T-1a2b3c4d');
          claimed = new Set(ids);
        }
      }
      const opts = analyzeOptions(args, err);
      if (!opts) return EXIT.INVALID;
      // The baseline fixes the methodology: same rubric, same profile, same themes unless told otherwise.
      opts.themes ??= before.themes;
      opts.repo ??= before.input.repo ?? undefined;
      const ctx = context(args, { err, root: realRoot, profileFallback: before.profile.source === 'registry' ? before.profile.id : undefined, rubricRef: `${before.rubric.id}-${before.rubric.version}` });
      if (ctx.code !== undefined) return ctx.code;

      const after = await analyze({
        root: realRoot, profile: ctx.found.resolved, profileInfo: { source: ctx.profileSource }, rubricBundle: ctx.bundle,
        reportsDir: args.flags['--reports'], ...opts,
      });
      const result = verify(before, after, { plan: planDoc, claimed, claimAll });
      const json = `${stableStringify(result)}\n`;
      if (outDir === undefined) { out(json.trimEnd()); return result.exit; }
      writeFileAtomic(join(outDir, 'verification.json'), json);
      writeFileAtomic(join(outDir, 'analysis.json'), `${stableStringify(after)}\n`);
      const md = renderVerification(result);
      writeFileAtomic(join(outDir, 'verification.md'), md);
      out(md.trimEnd());
      return result.exit;
    }

    // ------------------------------------------------------------ evidence assemble
    if (args.positional.length) return invalid(`unexpected argument ${args.positional[0]}`);
    const analysisPath = args.flags['--analysis'];
    if (!analysisPath) return invalid('evidence assemble needs --analysis <analysis.json>');
    if (args.flags['--built-by'] === undefined) return invalid('evidence assemble needs --built-by <id>: the scorer cannot verify independence without knowing who built the change');
    const builtBy = args.flags['--built-by'];
    if (builtBy.trim() === '' || builtBy.length > 100) return invalid('--built-by must be 1 to 100 characters');
    const at = args.flags['--assistive-tech'];
    if (at !== undefined && at !== 'true' && at !== 'false') return invalid('--assistive-tech must be true or false');
    if (args.flags['--repo'] !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(args.flags['--repo'])) return invalid('--repo must look like owner/name');
    if (args.flags['--commit'] !== undefined && !/^[0-9a-f]{40}$/.test(args.flags['--commit'])) return invalid('--commit must be 40 lowercase hex characters');

    const analysis = readEngineDocument(analysisPath, 'brand-analysis', 'analysis');
    const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();
    const reg = loadBrandDir(brandDir);
    if (reg.errors.length) { for (const e of reg.errors) err(`${e.file}: ${e.message}`); err('refused: brand data is invalid; run `brand-engine profile validate`'); return EXIT.REFUSED; }
    const bundle = loadRubric(brandDir, `${analysis.rubric.id}-${analysis.rubric.version}`);
    if (bundle.sha256 !== analysis.rubric.sha256) { err('refused: the analysis used a different rubric hash than the one on disk'); return EXIT.REFUSED; }

    let assessments;
    if (args.flags['--assessments'] !== undefined) {
      const text = readBounded(args.flags['--assessments'], 'assessments');
      assessments = { ...parseAssessments(args.flags['--assessments'], text, bundle.rubric), sha256: sha256Hex(text) };
    }
    let observed;
    if (args.flags['--observed'] !== undefined) {
      const text = readBounded(args.flags['--observed'], 'observed');
      observed = { ...parseObserved(args.flags['--observed'], text, bundle.rubric), sha256: sha256Hex(text) };
    }
    const evidence = assemble({
      analysis, rubric: bundle.rubric, assessments, observed, builtBy,
      generatedAt: args.flags['--generated-at'], repo: args.flags['--repo'], commit: args.flags['--commit'],
      assistiveTechnologyTestingPossible: at === 'true',
    });
    const json = `${stableStringify(evidence)}\n`;
    const target = args.flags['-o'];
    if (target === undefined || target === '-') { out(json.trimEnd()); return EXIT.OK; }
    writeFileAtomic(target, json);
    out(`wrote ${target}: ${evidence.automated.length} automated, ${evidence.expert.length} expert, ${evidence.observed.length} observed, ${evidence.findings.length} finding(s)`);
    return EXIT.OK;
  } catch (error) {
    if (error instanceof DocError) { err(error.message); return error.refused ? EXIT.REFUSED : EXIT.INVALID; }
    if (error instanceof AdapterError) { err(error.message); return EXIT.INVALID; }
    if (error instanceof AnalyzeError) { err(error.message); return EXIT.INVALID; }
    if (error instanceof AssembleError || error instanceof EvidenceError) { for (const m of error.errors) err(`invalid: ${m}`); return EXIT.INVALID; }
    if (error instanceof VerifyRefused) { err(`refused: ${error.message}`); return EXIT.REFUSED; }
    if (error instanceof Refused) { err(error.message); return EXIT.REFUSED; }
    throw error;
  }
}

export { DEFAULT_THEMES };

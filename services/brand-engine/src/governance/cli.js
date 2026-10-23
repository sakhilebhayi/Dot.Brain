// services/brand-engine/src/governance/cli.js
//
// propose init | propose submit | lint-proposal
//
// Exit codes:
//   0  done / clean (warnings do not fail)
//   1  the lint refused a proposal (propose submit: nothing was written)
//   2  invalid input (usage, an unreadable or malformed file, a flag value that is not valid)
//   3  refused: `propose submit` was given a proposal that is not a draft
//
// Offline and read-only apart from the one file named by -o. It reads no
// environment variable and no clock (the times come from flags), so no secret
// can reach an output and the same input gives the same bytes. No command can
// set a proposal's final status: a human owner does that, in a reviewed merge.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stableStringify } from '../json.js';
import { defaultBrandDir } from '../registry.js';
import { DocError, readBounded } from '../analyze/docs.js';
import { checkGovernance, lintProposal } from './lint.js';
import { ProposeError, initProposal, submitProposal } from './propose.js';
import { TARGET_KINDS } from './targets.js';

export const GOVERNANCE_COMMANDS = ['propose', 'lint-proposal'];

export const GOVERNANCE_USAGE = [
  'usage: brand-engine propose init --target <profile|principle|rubric|doctrine>:<id> [--new] --author-id <id> --author-kind <human|ai> --author-name <name> --created-at <date-time> [--slug <words>] [-o <proposal.json>] [--brand-dir <dir>]',
  '       brand-engine propose submit <proposal.json> --actor-id <id> --actor-kind <human|ai> --at <date-time> [-o <proposal.json>] [--brand-dir <dir>]',
  '       brand-engine lint-proposal <proposal.json>... [--json] [--brand-dir <dir>]',
  '       brand-engine lint-proposal --check-ratified [--json] [--brand-dir <dir>]',
].join('\n');

const FLAGS = {
  init: { value: new Set(['--target', '--author-id', '--author-kind', '--author-name', '--created-at', '--slug', '-o', '--brand-dir']), bool: new Set(['--new']) },
  submit: { value: new Set(['--actor-id', '--actor-kind', '--at', '-o', '--brand-dir']), bool: new Set() },
  lint: { value: new Set(['--brand-dir']), bool: new Set(['--json', '--check-ratified']) },
};

function parse(kind, argv) {
  const spec = FLAGS[kind];
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('-') && arg.length > 1) {
      if (spec.bool.has(arg)) {
        if (Object.hasOwn(flags, arg)) return { error: `${arg} given twice` };
        flags[arg] = true;
        continue;
      }
      if (!spec.value.has(arg)) return { error: `unknown argument ${arg}` };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (Object.hasOwn(flags, arg)) return { error: `${arg} given twice` };
      flags[arg] = value;
      i += 1;
    } else positional.push(arg);
  }
  return { positional, flags };
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isDateTime = (s) => DATE_TIME.test(s) && !Number.isNaN(Date.parse(s));
const isAbsent = (v) => v === undefined || String(v).trim() === '';

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function formatLint(file, status, result, out) {
  const head = result.ok ? 'ok' : 'refused';
  out(`${file}: ${head}${status ? ` (status ${status})` : ''}: ${result.errors.length} error(s), ${result.warnings.length} warning(s)`);
  for (const e of result.errors) out(`  error [${e.code}] ${e.path}: ${e.message}`);
  for (const w of result.warnings) out(`  warning [${w.code}] ${w.path}: ${w.message}`);
}

export function governanceMain(argv, deps = {}) {
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));
  const invalid = (message) => { err(`${message}\n${GOVERNANCE_USAGE}`); return 2; };

  let command = argv[0];
  let rest = argv.slice(1);
  if (command === 'propose') {
    const sub = argv[1];
    if (sub !== 'init' && sub !== 'submit') return invalid('propose needs the subcommand init or submit');
    command = sub;
    rest = argv.slice(2);
  } else command = 'lint';
  const args = parse(command, rest);
  if (args.error) return invalid(args.error);
  const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();

  try {
    // ------------------------------------------------------------ propose init
    if (command === 'init') {
      if (args.positional.length) return invalid(`unexpected argument ${args.positional[0]}`);
      const f = args.flags;
      for (const flag of ['--target', '--author-id', '--author-kind', '--author-name', '--created-at']) if (isAbsent(f[flag])) return invalid(`propose init needs ${flag}`);
      const m = /^(profile|principle|rubric|doctrine):(.+)$/.exec(f['--target']);
      if (!m || !TARGET_KINDS.includes(m[1])) return invalid('--target must look like profile:infodot, principle:BXP-03, rubric:bxqs or doctrine:brain.brand_experience');
      if (!['human', 'ai'].includes(f['--author-kind'])) return invalid('--author-kind must be human or ai');
      if (!isDateTime(f['--created-at'])) return invalid('--created-at must be a date-time such as 2026-10-23T12:00:00Z (the engine reads no clock)');
      const output = f['-o'];
      if (output !== undefined && output !== '-' && existsSync(output)) { err(`${output} already exists; propose init never overwrites a file`); return 2; }
      const doc = initProposal({
        brandDir, kind: m[1], id: m[2], isNew: f['--new'] === true, createdAt: f['--created-at'], slug: f['--slug'],
        author: { id: f['--author-id'], kind: f['--author-kind'], display_name: f['--author-name'] },
      });
      const problems = lintProposal(doc, { brandDir });
      if (problems.errors.length) { for (const e of problems.errors) err(`internal [${e.code}] ${e.path}: ${e.message}`); err('the engine produced a draft that fails its own lint'); return 2; }
      const json = `${stableStringify(doc)}\n`;
      if (output === undefined || output === '-') { out(json.trimEnd()); return 0; }
      writeAtomic(output, json);
      out(`wrote ${output}: draft ${doc.id} (${m[1]} ${m[2]} ${doc.target.from_version ?? 'new'} -> ${doc.target.to_version}). Replace every TODO, then run lint-proposal and propose submit`);
      return 0;
    }

    // ------------------------------------------------------------ propose submit
    if (command === 'submit') {
      if (args.positional.length !== 1) return invalid('propose submit needs exactly one proposal file');
      const f = args.flags;
      for (const flag of ['--actor-id', '--actor-kind', '--at']) if (isAbsent(f[flag])) return invalid(`propose submit needs ${flag}`);
      if (!['human', 'ai'].includes(f['--actor-kind'])) return invalid('--actor-kind must be human or ai');
      if (!isDateTime(f['--at'])) return invalid('--at must be a date-time such as 2026-10-23T12:00:00Z (the engine reads no clock)');
      const input = args.positional[0];
      const output = f['-o'];
      if (output !== undefined && output !== '-' && existsSync(output) && resolve(output) !== resolve(input)) { err(`${output} already exists and is not the input; propose submit only replaces the file it was given`); return 2; }
      let doc;
      try { doc = JSON.parse(readBounded(input, 'proposal')); } catch (error) {
        if (error instanceof DocError) throw error;
        err(`proposal ${input}: invalid JSON`); return 2;
      }
      const result = submitProposal(doc, { brandDir, actor: { id: f['--actor-id'], kind: f['--actor-kind'] }, at: f['--at'] });
      const json = `${stableStringify(result.doc)}\n`;
      for (const w of result.warnings) err(`warning [${w.code}] ${w.path}: ${w.message}`);
      if (output === undefined || output === '-') { out(json.trimEnd()); return 0; }
      writeAtomic(output, json);
      out(`wrote ${output}: ${result.doc.id} is now proposed (by ${f['--actor-kind']} ${f['--actor-id']}). Ratification is the owner's: a person edits the file in a reviewed merge`);
      return 0;
    }

    // ------------------------------------------------------------ lint-proposal
    const json = args.flags['--json'] === true;
    if (args.flags['--check-ratified'] === true) {
      if (args.positional.length) return invalid('--check-ratified takes no proposal file');
      const result = checkGovernance(brandDir);
      if (json) out(stableStringify({ check: 'ratified', ok: result.ok, errors: result.errors, warnings: result.warnings }));
      else formatLint('brand/governance (ratified documents against the ledger)', '', result, out);
      return result.ok ? 0 : 1;
    }
    if (args.positional.length === 0) return invalid('lint-proposal needs at least one proposal file, or --check-ratified');
    const reports = [];
    for (const file of args.positional) {
      let doc;
      try { doc = JSON.parse(readBounded(file, 'proposal')); } catch (error) {
        if (error instanceof DocError) throw error;
        err(`proposal ${file}: invalid JSON`); return 2;
      }
      const result = lintProposal(doc, { brandDir });
      reports.push({ file, status: typeof doc?.status === 'string' ? doc.status : null, ...result });
    }
    if (json) out(stableStringify({ files: reports }));
    else for (const r of reports) formatLint(r.file, r.status, r, out);
    return reports.every((r) => r.ok) ? 0 : 1;
  } catch (error) {
    if (error instanceof DocError) { err(error.message); return 2; }
    if (error instanceof ProposeError) {
      err(error.message);
      for (const e of error.findings) err(`  error [${e.code}] ${e.path}: ${e.message}`);
      return error.refused ? 3 : error.findings.length ? 1 : 2;
    }
    throw error;
  }
}

// services/brand-engine/src/score/cli.js
//
// score | compare | rubric. Exit: 0 report produced / ok
//                              2 invalid input (usage, evidence, profile)
//                              3 refused (modified or unreleased rubric, invalid brand
//                                data, comparison across a major version)
// Offline and read-only. It reads no environment variable and no clock, so no
// secret can reach the output and the same input gives the same bytes.
import { stableStringify, readJson } from '../json.js';
import { defaultBrandDir, loadBrandDir, lookupProfile } from '../registry.js';
import { compareReports } from './compare.js';
import { EXIT, EvidenceError, Refused } from './constants.js';
import { scoreReport } from './engine.js';
import { latestRubricRef, loadRubric } from './rubric.js';
import { validateReportShape } from './schemas.js';

export const SCORE_USAGE = [
  'usage: brand-engine score --evidence <file> --profile <id|file> [--rubric bxqs-1.0.0] [--built-by <id>] [--brand-dir <dir>]',
  '       brand-engine compare <baseline-report.json> <candidate-report.json>',
  '       brand-engine rubric show [<bxqs-1.0.0>] [--brand-dir <dir>]',
  '       brand-engine rubric validate [<bxqs-1.0.0>] [--brand-dir <dir>]',
].join('\n');

const FLAGS = {
  score: new Set(['--evidence', '--profile', '--rubric', '--built-by', '--brand-dir']),
  compare: new Set([]),
  rubric: new Set(['--brand-dir']),
};

function parse(group, argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (!FLAGS[group].has(arg)) return { error: `unknown argument ${arg}` };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value` };
      if (Object.hasOwn(flags, arg)) return { error: `${arg} given twice` };
      flags[arg] = value;
      i += 1;
    } else positional.push(arg);
  }
  return { positional, flags };
}

function readInput(path, what) {
  const read = readJson(path);
  return read.ok ? { value: read.value } : { error: `${what} ${path}: ${read.error}` };
}

export function scoreMain(argv, deps = {}) {
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));
  const [group, ...rest] = argv;
  const invalid = (message) => { err(`${message}\n${SCORE_USAGE}`); return EXIT.INVALID; };

  const args = parse(group, rest);
  if (args.error) return invalid(args.error);
  const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();

  try {
    if (group === 'compare') {
      if (args.positional.length !== 2) return invalid('compare needs exactly two report files');
      const [a, b] = args.positional.map((p) => readInput(p, 'report'));
      for (const r of [a, b]) if (r.error) { err(r.error); return EXIT.INVALID; }
      out(stableStringify(compareReports(a.value, b.value)));
      return EXIT.OK;
    }

    if (group === 'rubric') {
      const [sub, ref, ...extra] = args.positional;
      if (!['show', 'validate'].includes(sub) || extra.length) return invalid('rubric needs show or validate');
      const bundle = loadRubric(brandDir, ref ?? latestRubricRef(brandDir));
      if (sub === 'show') out(stableStringify(bundle.rubric));
      else {
        const weight = bundle.rubric.dimensions.reduce((s, d) => s + d.weight, 0);
        out(`ok ${bundle.ref} sha256=${bundle.sha256} weights=${weight} dimensions=${bundle.rubric.dimensions.length} ${bundle.ratification ? `ratified by ${bundle.ratification.approver.id}` : 'proposed (not ratified)'}`);
      }
      return EXIT.OK;
    }

    // score
    const evidencePath = args.flags['--evidence'];
    const profileArg = args.flags['--profile'];
    if (args.positional.length) return invalid(`unexpected argument ${args.positional[0]}`);
    if (!evidencePath || !profileArg) return invalid('score needs --evidence and --profile');

    const evidence = readInput(evidencePath, 'evidence');
    if (evidence.error) { err(evidence.error); return EXIT.INVALID; }

    const reg = loadBrandDir(brandDir);
    if (reg.errors.length) {
      for (const e of reg.errors) err(`${e.file}: ${e.message}`);
      err('refused: brand data is invalid; run `brand-engine profile validate`');
      return EXIT.REFUSED;
    }
    const found = lookupProfile(profileArg, reg);
    if (found.errors.length || !found.resolved) {
      for (const m of found.errors) err(`profile: ${m}`);
      return EXIT.INVALID;
    }
    for (const w of found.warnings) err(`warning: ${w}`);

    const bundle = loadRubric(brandDir, args.flags['--rubric']);

    const input = evidence.value;
    const builtBy = args.flags['--built-by'];
    if (builtBy !== undefined) {
      if (input !== null && typeof input === 'object' && input.built_by !== undefined && input.built_by !== builtBy) {
        return invalid(`--built-by ${builtBy} contradicts built_by ${input.built_by} in the evidence file`);
      }
      if (input !== null && typeof input === 'object' && !Array.isArray(input)) input.built_by = builtBy;
    }

    const report = scoreReport(input, bundle.rubric, found.resolved, { rubricRatification: bundle.ratification });
    const problems = validateReportShape(report);
    if (problems.length) {
      for (const m of problems) err(`internal: ${m}`);
      err('refused: the engine produced a report that fails its own schema');
      return EXIT.REFUSED;
    }
    out(stableStringify(report));
    return EXIT.OK;
  } catch (error) {
    if (error instanceof EvidenceError) {
      for (const m of error.errors) err(`invalid: ${m}`);
      return EXIT.INVALID;
    }
    if (error instanceof Refused) { err(error.message); return EXIT.REFUSED; }
    throw error;
  }
}

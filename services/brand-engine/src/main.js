// services/brand-engine/src/main.js
//
// Exit (profile, framework, drift):
//       0 ok
//       1 findings: invalid data, an unresolvable profile, or drift
//       2 usage error
// Exit (score, compare, rubric; see score/cli.js):
//       0 report produced, 2 invalid input, 3 refused
// Exit (analyze, plan, verify, evidence assemble; see analyze/cli.js):
//       0 done, 1 verify found regressions, 2 invalid input, 3 refused
// Exit (propose, lint-proposal; see governance/cli.js):
//       0 ok, 1 the lint refused a proposal, 2 invalid input, 3 refused (not a draft)
//
// Read-only and offline. No environment variable is read, so there is
// nothing secret that could reach the output.
import { checkDrift, DriftUsageError } from './drift.js';
import { stableStringify } from './json.js';
import { defaultBrandDir, loadBrandDir, lookupProfile } from './registry.js';
import { SCORE_USAGE, scoreMain } from './score/cli.js';
import { WORKFLOW_COMMANDS, WORKFLOW_USAGE, workflowMain } from './analyze/cli.js';
import { GOVERNANCE_COMMANDS, GOVERNANCE_USAGE, governanceMain } from './governance/cli.js';

export const USAGE = [
  'usage: brand-engine profile list [--brand-dir <dir>]',
  '       brand-engine profile show <id|file> [--brand-dir <dir>]',
  '       brand-engine profile validate [<id|file>] [--brand-dir <dir>]',
  '       brand-engine profile resolve <id|file> [--brand-dir <dir>]',
  '       brand-engine framework list [--brand-dir <dir>]',
  '       brand-engine framework show <BXP-NN> [--brand-dir <dir>]',
  '       brand-engine drift <id|file> --root <checkout> [--repo <owner/name>] [--brand-dir <dir>]',
  SCORE_USAGE,
  WORKFLOW_USAGE,
  GOVERNANCE_USAGE,
].join('\n');

const FLAGS = new Set(['--brand-dir', '--root', '--repo']);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      if (!FLAGS.has(arg)) return { error: `unknown argument ${arg}\n${USAGE}` };
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value\n${USAGE}` };
      if (Object.hasOwn(flags, arg)) return { error: `${arg} given twice\n${USAGE}` };
      flags[arg] = value;
      i += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

const pad = (s, n) => String(s).padEnd(n);

function printFindings(err, file, list, prefix = '') {
  for (const m of list) err(`${prefix}${file ? `${file}: ` : ''}${m}`);
}

/**
 * Everything injectable, so the CLI is tested without a process. Returns the
 * exit code, or a Promise of it for the workflow commands (analyze, plan,
 * verify, evidence), which run checks in worker threads.
 */
export function main(argv, deps = {}) {
  const out = deps.out ?? ((line) => console.log(line));
  const err = deps.err ?? ((line) => console.error(line));

  if (['score', 'compare', 'rubric'].includes(argv[0])) return scoreMain(argv, deps);
  if (WORKFLOW_COMMANDS.includes(argv[0])) return workflowMain(argv, deps);
  if (GOVERNANCE_COMMANDS.includes(argv[0])) return governanceMain(argv, deps);

  const args = parseArgs(argv);
  if (args.error) { err(args.error); return 2; }
  const [group, sub, target, ...extra] = args.positional;
  const brandDir = args.flags['--brand-dir'] ?? defaultBrandDir();

  if (!['profile', 'framework', 'drift'].includes(group)) { err(USAGE); return 2; }
  if (extra.length) { err(`unexpected argument ${extra[0]}\n${USAGE}`); return 2; }

  // drift <profile> has no subcommand: the second positional is the profile.
  const driftTarget = group === 'drift' ? sub : undefined;
  if (group === 'drift' && (driftTarget === undefined || target !== undefined)) { err(USAGE); return 2; }
  if (group !== 'drift' && (args.flags['--root'] || args.flags['--repo'])) { err(`--root and --repo only apply to drift\n${USAGE}`); return 2; }

  const reg = loadBrandDir(brandDir);
  const loadFailed = reg.errors.length > 0;

  // `validate` is the one command whose job is to report load problems.
  const isValidateAll = group === 'profile' && sub === 'validate' && target === undefined;
  if (loadFailed && !isValidateAll) {
    for (const e of reg.errors) err(`${e.file}: ${e.message}`);
    err('brand data is invalid; run `brand-engine profile validate` for the full report');
    return 1;
  }

  if (group === 'framework') {
    if (sub === 'list' && target === undefined) {
      for (const p of [...reg.principles.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        out(`${pad(p.id, 8)}${pad(p.version, 8)}${pad(p.status, 11)}${p.title}`);
      }
      return 0;
    }
    if (sub === 'show' && target !== undefined) {
      const p = reg.principles.get(target);
      if (!p) { err(`unknown principle ${target}`); return 1; }
      out(stableStringify(p));
      return 0;
    }
    err(USAGE);
    return 2;
  }

  if (group === 'profile') {
    if (sub === 'list' && target === undefined) {
      for (const p of [...reg.profiles.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
        out(`${pad(p.id, 16)}${pad(p.kind, 11)}${pad(p.version, 8)}${pad(p.status, 11)}${p.extends ?? '-'}`);
      }
      return 0;
    }
    if (isValidateAll) {
      for (const e of reg.errors) err(`error: ${e.file}: ${e.message}`);
      for (const w of reg.warnings) out(`warning: ${w.file}: ${w.message}`);
      const ids = [...reg.profiles.keys()].sort();
      for (const id of ids) { const p = reg.profiles.get(id); out(`profile ${id}@${p.version} (${p.status})`); }
      for (const id of [...reg.principles.keys()].sort()) { const p = reg.principles.get(id); out(`principle ${id}@${p.version} (${p.status})`); }
      out(`${reg.profiles.size} profile(s), ${reg.principles.size} principle(s), ${reg.errors.length} error(s), ${reg.warnings.length} warning(s)`);
      return reg.errors.length ? 1 : 0;
    }
    if (['show', 'validate', 'resolve'].includes(sub) && target !== undefined) {
      const found = lookupProfile(target, reg);
      for (const w of found.warnings) out(`warning: ${w}`);
      if (found.errors.length) {
        printFindings(err, '', found.errors, 'error: ');
        return 1;
      }
      if (sub === 'show') out(stableStringify(found.profile));
      else if (sub === 'resolve') out(stableStringify(found.resolved));
      else out(`ok ${found.profile.id}@${found.profile.version} (${found.profile.status}; effective ${found.resolved.effective_status})`);
      return 0;
    }
    err(USAGE);
    return 2;
  }

  // drift
  const root = args.flags['--root'];
  if (root === undefined) { err(`drift needs --root <checkout>\n${USAGE}`); return 2; }
  const found = lookupProfile(driftTarget, reg);
  if (found.errors.length) { printFindings(err, '', found.errors, 'error: '); return 1; }
  let result;
  try {
    result = checkDrift(found.profile, { root, repo: args.flags['--repo'] });
  } catch (error) {
    if (error instanceof DriftUsageError) { err(`${error.message}\n${USAGE}`); return 2; }
    throw error;
  }
  if (result.checked.length === 0) out(`${found.profile.id}@${found.profile.version}: no cited files to check`);
  for (const c of result.checked) {
    const extraInfo = c.status === 'changed' ? ` recorded ${c.recorded_sha256} actual ${c.actual_sha256}` : c.detail ? ` (${c.detail})` : '';
    out(`${c.status.toUpperCase()} ${c.repo}/${c.path}${extraInfo}`);
  }
  for (const s of result.skipped) out(`SKIPPED ${s.repo}/${s.path} (other repository)`);
  out(`${result.checked.length} checked, ${result.drifted} drifted, ${result.skipped.length} skipped`);
  return result.ok ? 0 : 1;
}

// services/infodot-knowledge/src/main.js
//
// Exit: 0 run completed (a dry run, or every decision written)
//       1 fail closed: environment unset/invalid, a read failed (nothing was
//         written), or at least one write failed
//       2 usage error
import { appendFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from './env.js';
import { redact } from './redact.js';
import { formatSummary, runKnowledge } from './run.js';
import { MAX_LIMIT } from './infodot.js';

export const USAGE = 'usage: infodot-knowledge run [--dry-run | --apply] [--since <ISO8601>] [--limit <1-100>] [--summary-file <path>]';

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (cmd !== 'run') return { error: USAGE };

  const out = { apply: false, since: undefined, limit: undefined, summaryFile: undefined };
  const known = new Set(['--dry-run', '--apply', '--since', '--limit', '--summary-file']);
  let dry = false;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (!known.has(arg)) return { error: `unknown argument ${arg}\n${USAGE}` };
    if (arg === '--dry-run') dry = true;
    else if (arg === '--apply') out.apply = true;
    else {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value\n${USAGE}` };
      i += 1;
      if (arg === '--since') out.since = value;
      if (arg === '--limit') out.limit = value;
      if (arg === '--summary-file') out.summaryFile = value;
    }
  }

  if (dry && out.apply) return { error: `--dry-run and --apply are mutually exclusive\n${USAGE}` };
  if (out.since !== undefined && (!/^\d{4}-\d{2}-\d{2}/.test(out.since) || Number.isNaN(Date.parse(out.since)))) {
    return { error: `--since must be an ISO 8601 timestamp\n${USAGE}` };
  }
  if (out.limit !== undefined) {
    const n = Number(out.limit);
    if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return { error: `--limit must be an integer from 1 to ${MAX_LIMIT}\n${USAGE}` };
    out.limit = n;
  }
  return out;
}

/** Everything injectable, so the CLI is tested without a process, a network or a clock. */
export async function main(argv, env = process.env, deps = {}) {
  const {
    out = (line) => console.log(line),
    err = (line) => console.error(line),
    fetchImpl = fetch,
    now = () => new Date(),
    sleep,
    delaysMs,
    timeoutMs,
    write = writeFileSync,
    append = appendFileSync,
  } = deps;

  const args = parseArgs(argv);
  if (args.error) {
    err(args.error);
    return 2;
  }

  const loaded = loadEnv(env);
  if (!loaded.ok) {
    if (loaded.missing.length) err(`not configured: ${loaded.missing.join(', ')} must be set; nothing was read or written`);
    if (loaded.invalid.length) err(`invalid: ${loaded.invalid.join(', ')} must be an https URL; nothing was read or written`);
    return 1;
  }
  const { cfg } = loaded;
  const secrets = [cfg.secret, cfg.memoryToken];

  let result;
  try {
    result = await runKnowledge({
      cfg, apply: args.apply, since: args.since, limit: args.limit, now, fetchImpl, sleep, delaysMs, timeoutMs,
    });
  } catch (error) {
    err(redact(`crash: ${error?.message ?? error}`, secrets));
    return 1;
  }

  if (!result.ok) {
    err(redact(`failed at ${result.stage}: ${result.reason}; nothing was written`, secrets));
    return 1;
  }

  const text = formatSummary(result.summary);
  out(text);

  if (args.summaryFile) {
    try {
      write(args.summaryFile, `${JSON.stringify(result.summary, null, 2)}\n`);
    } catch (error) {
      err(redact(`warning: could not write summary file: ${error.message}`, secrets));
    }
  }
  if (env.GITHUB_STEP_SUMMARY) {
    try {
      append(env.GITHUB_STEP_SUMMARY, `## InfoDot knowledge candidates\n\n\`\`\`\n${text}\n\`\`\`\n`);
    } catch (error) {
      err(redact(`warning: could not write job summary: ${error.message}`, secrets));
    }
  }

  return result.summary.write_failed > 0 ? 1 : 0;
}

// Is the guardian's own GitHub token still good, and can it reach every
// repository it is enrolled to act on?
//
// The guardian is only as useful as GUARDIAN_GH_TOKEN: when it expires the
// polls keep running but nothing can be raised, and until now nothing said so
// (the 5 platforms enrolled on 2026-10-17 were outside the token's scope and
// the only symptom was a failed `gh issue create` in a log).
//
// usage: node src/token-check.js [--manifest-dir <dir>]
// env:   GUARDIAN_GH_TOKEN (read as GH_TOKEN by the workflow)
// exit:  0 ok or warnings, 1 token rejected or expiring within FAIL_DAYS
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadManifests } from './registry.js';

export const WARN_DAYS = 14;
export const FAIL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-11-25 00:00:00 UTC" (GitHub's github-authentication-token-expiration header) -> Date, or null. */
export function parseExpiry(header) {
  if (typeof header !== 'string' || header.trim() === '') return null;
  const m = header.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(?:UTC|Z)?$/);
  if (!m) return null;
  const date = new Date(`${m[1]}T${m[2]}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Pure verdict from what the probes saw.
 * @param {{ results: Array<{ repo: string, status: number }>, expiryHeader: string|null }} probe
 * @returns {{ level: 'ok'|'warn'|'fail', daysLeft: number|null, findings: string[] }}
 */
export function assess({ results, expiryHeader }, now = new Date()) {
  const findings = [];
  let level = 'ok';
  const raise = (to) => { if (to === 'fail' || (to === 'warn' && level === 'ok')) level = to; };

  if (results.length > 0 && results.every((r) => r.status === 401)) {
    return { level: 'fail', daysLeft: null, findings: ['GitHub rejected the token (HTTP 401): it is expired or revoked. The guardian cannot raise issues or open pull requests.'] };
  }

  const expiry = parseExpiry(expiryHeader);
  let daysLeft = null;
  if (expiry) {
    daysLeft = Math.floor((expiry.getTime() - now.getTime()) / DAY_MS);
    if (daysLeft <= FAIL_DAYS) {
      raise('fail');
      findings.push(`The token expires ${daysLeft < 0 ? 'already (' + expiry.toISOString().slice(0, 10) + ')' : 'in ' + daysLeft + ' day(s) (' + expiry.toISOString().slice(0, 10) + ')'}. Rotate GUARDIAN_GH_TOKEN now.`);
    } else if (daysLeft <= WARN_DAYS) {
      raise('warn');
      findings.push(`The token expires in ${daysLeft} days (${expiry.toISOString().slice(0, 10)}). Rotate it before then.`);
    }
  } else {
    findings.push('GitHub reports no expiry for this token (a classic token, or one created without an expiry). Nothing to rotate on a date, but it never warns you either.');
  }

  const unreachable = results.filter((r) => r.status !== 200 && r.status !== 401);
  if (unreachable.length > 0) {
    raise('warn');
    findings.push(`The token cannot read issues in ${unreachable.length} enrolled repositor${unreachable.length === 1 ? 'y' : 'ies'}: ${unreachable.map((r) => `${r.repo} (HTTP ${r.status})`).join(', ')}. The guardian cannot open issues there; add them to the token's repository access.`);
  }
  const partial401 = results.filter((r) => r.status === 401);
  if (partial401.length > 0 && partial401.length < results.length) {
    raise('warn');
    findings.push(`HTTP 401 for ${partial401.map((r) => r.repo).join(', ')} while other repositories answered: check the token's access.`);
  }

  return { level, daysLeft, findings };
}

/** Probe every enrolled repo with a read of its issues. Returns the raw facts. */
export async function probe({ token, repos, fetchImpl = fetch }) {
  const results = [];
  let expiryHeader = null;
  for (const repo of repos) {
    try {
      const response = await fetchImpl(`https://api.github.com/repos/${repo}/issues?per_page=1&state=open`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dot-guardian-token-check' },
        signal: AbortSignal.timeout(15000),
      });
      results.push({ repo, status: response.status });
      expiryHeader ??= response.headers.get('github-authentication-token-expiration');
    } catch (error) {
      results.push({ repo, status: 0 });
    }
  }
  return { results, expiryHeader };
}

export function summaryMarkdown(verdict, results) {
  const icon = { ok: 'OK', warn: 'WARNING', fail: 'FAILING' }[verdict.level];
  const rows = results.map((r) => `| ${r.repo} | ${r.status === 200 ? 'reachable' : `HTTP ${r.status}`} |`).join('\n');
  return `## Guardian token check: ${icon}\n\n${verdict.findings.map((f) => `- ${f}`).join('\n')}\n\n| Enrolled repository | Issues API |\n|---|---|\n${rows}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf('--manifest-dir');
  const dir = i >= 0 ? args[i + 1] : fileURLToPath(new URL('../../../platforms/guardian', import.meta.url));
  const token = process.env.GH_TOKEN || process.env.GUARDIAN_GH_TOKEN;

  if (!token) {
    console.log('::warning::GUARDIAN_GH_TOKEN is not set: the guardian cannot raise issues, and there is nothing to check.');
    return 0;
  }
  const repos = [...new Set(loadManifests(dir).map((m) => m.repo))].sort();
  const { results, expiryHeader } = await probe({ token, repos });
  const verdict = assess({ results, expiryHeader });
  const md = summaryMarkdown(verdict, results);
  console.log(md);
  for (const f of verdict.findings) {
    if (verdict.level === 'fail') console.log(`::error::${f}`);
    else if (verdict.level === 'warn') console.log(`::warning::${f}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  return verdict.level === 'fail' ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code), (error) => { console.error(error); process.exit(1); });
}

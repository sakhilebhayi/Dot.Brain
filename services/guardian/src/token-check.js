// Is the guardian's own GitHub token still good, and can it CREATE ISSUES in
// every repository it is enrolled to act on?
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
 * `read` is the status of reading the repo's issues. These repositories are public, so a read
 * succeeds for ANY valid token and proves nothing about write access; it only shows the token
 * is accepted. `write` is the status of a deliberately INVALID issue-create request
 * (see probe()): 422 means GitHub let the token through to validate the body, 403/404 means
 * the token has no Issues: write on that repository.
 * @param {{ results: Array<{ repo: string, read: number, write: number }>, expiryHeader: string|null }} probe
 * @returns {{ level: 'ok'|'warn'|'fail', daysLeft: number|null, findings: string[] }}
 */
export function assess({ results, expiryHeader }, now = new Date()) {
  const findings = [];
  let level = 'ok';
  const raise = (to) => { if (to === 'fail' || (to === 'warn' && level === 'ok')) level = to; };

  if (results.length > 0 && results.every((r) => r.read === 401 || r.write === 401)) {
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

  const cannotWrite = results.filter((r) => r.write === 403 || r.write === 404);
  if (cannotWrite.length > 0) {
    raise('warn');
    findings.push(`The token cannot create issues in ${cannotWrite.length} of ${results.length} enrolled repositor${results.length === 1 ? 'y' : 'ies'}: ${cannotWrite.map((r) => r.repo).join(', ')}. The guardian can detect and record problems there but cannot open advice or escalation issues. Give the token Issues: read and write on them.`);
  }
  const unknown = results.filter((r) => ![403, 404, 422, 401].includes(r.write) || (r.read !== 200 && r.read !== 401));
  if (unknown.length > 0) {
    raise('warn');
    findings.push(`Unexpected answers from GitHub for ${unknown.map((r) => `${r.repo} (read ${r.read}, write probe ${r.write})`).join(', ')}.`);
  }

  return { level, daysLeft, findings };
}

/**
 * Probe every enrolled repo twice:
 *  - read the issues (is the token accepted at all; also yields the expiry header);
 *  - POST an issue whose title is an ARRAY. That body can never be valid, so GitHub
 *    answers 422 and creates nothing, but only after deciding the token may create
 *    issues here. A token without Issues: write is refused first (403/404).
 */
export async function probe({ token, repos, fetchImpl = fetch }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dot-guardian-token-check' };
  const results = [];
  let expiryHeader = null;
  const call = async (url, options = {}) => {
    try {
      const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000), ...options });
      expiryHeader ??= response.headers.get('github-authentication-token-expiration');
      return response.status;
    } catch {
      return 0;
    }
  };
  for (const repo of repos) {
    const read = await call(`https://api.github.com/repos/${repo}/issues?per_page=1&state=open`);
    const write = await call(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: ['guardian token check: invalid on purpose, nothing is created'] }),
    });
    results.push({ repo, read, write });
  }
  return { results, expiryHeader };
}

export function summaryMarkdown(verdict, results) {
  const icon = { ok: 'OK', warn: 'WARNING', fail: 'FAILING' }[verdict.level];
  const word = (r) => (r.write === 422 ? 'can create issues' : (r.write === 403 || r.write === 404) ? 'CANNOT create issues' : r.write === 401 ? 'token rejected' : `unexpected (HTTP ${r.write})`);
  const rows = results.map((r) => `| ${r.repo} | ${r.read === 200 ? 'ok' : `HTTP ${r.read}`} | ${word(r)} |`).join('\n');
  return `## Guardian token check: ${icon}\n\n${verdict.findings.map((f) => `- ${f}`).join('\n')}\n\n| Enrolled repository | Read issues | Create issues |\n|---|---|---|\n${rows}\n`;
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

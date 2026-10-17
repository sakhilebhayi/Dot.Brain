import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, parseExpiry, probe, summaryMarkdown, FAIL_DAYS, WARN_DAYS } from '../src/token-check.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10) + ' 00:00:00 UTC';
const ok = (repos) => repos.map((repo) => ({ repo, status: 200 }));

test('parseExpiry reads GitHub\'s header format and rejects anything else', () => {
  assert.equal(parseExpiry('2026-11-25 00:00:00 UTC').toISOString(), '2026-11-25T00:00:00.000Z');
  assert.equal(parseExpiry('2026-11-25T08:30:00Z').toISOString(), '2026-11-25T08:30:00.000Z');
  for (const bad of [null, undefined, '', 'tomorrow', '25/11/2026', 42]) assert.equal(parseExpiry(bad), null);
});

test('a token with plenty of time and full access is OK', () => {
  const v = assess({ results: ok(['a/x', 'a/y']), expiryHeader: day(60) }, NOW);
  assert.equal(v.level, 'ok');
  assert.ok(v.daysLeft >= 59);
  assert.deepEqual(v.findings, []);
});

test('it warns inside the warning window and FAILS inside the last week', () => {
  assert.equal(assess({ results: ok(['a/x']), expiryHeader: day(WARN_DAYS) }, NOW).level, 'warn');
  assert.equal(assess({ results: ok(['a/x']), expiryHeader: day(FAIL_DAYS) }, NOW).level, 'fail');
  assert.equal(assess({ results: ok(['a/x']), expiryHeader: day(-1) }, NOW).level, 'fail');
  assert.match(assess({ results: ok(['a/x']), expiryHeader: day(-1) }, NOW).findings[0], /already/);
});

test('HTTP 401 everywhere means the token is dead', () => {
  const v = assess({ results: [{ repo: 'a/x', status: 401 }, { repo: 'a/y', status: 401 }], expiryHeader: null }, NOW);
  assert.equal(v.level, 'fail');
  assert.match(v.findings[0], /expired or revoked/);
});

test('repositories the token cannot reach are named, as a warning (the 2026-10-17 gap)', () => {
  const v = assess({
    results: [{ repo: 'a/mines', status: 200 }, { repo: 'a/forms', status: 404 }, { repo: 'a/sheet', status: 403 }],
    expiryHeader: day(90),
  }, NOW);
  assert.equal(v.level, 'warn');
  assert.match(v.findings.join(' '), /2 enrolled repositories: a\/forms \(HTTP 404\), a\/sheet \(HTTP 403\)/);
});

test('no expiry header is reported plainly and is not a failure', () => {
  const v = assess({ results: ok(['a/x']), expiryHeader: null }, NOW);
  assert.equal(v.level, 'ok');
  assert.match(v.findings[0], /no expiry/);
});

test('a network error counts as unreachable, not as a crash', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/a/boom/')) throw new Error('socket hang up');
    return { status: 200, headers: new Headers({ 'github-authentication-token-expiration': day(30) }) };
  };
  const { results, expiryHeader } = await probe({ token: 't', repos: ['a/ok', 'a/boom'], fetchImpl });
  assert.deepEqual(results, [{ repo: 'a/ok', status: 200 }, { repo: 'a/boom', status: 0 }]);
  assert.equal(expiryHeader, day(30));
});

test('the token is sent as a bearer header and never appears in the summary', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(options.headers.Authorization);
    return { status: 200, headers: new Headers() };
  };
  const { results } = await probe({ token: 'ghp_SECRETVALUE', repos: ['a/x'], fetchImpl });
  assert.deepEqual(seen, ['Bearer ghp_SECRETVALUE']);
  const md = summaryMarkdown(assess({ results, expiryHeader: null }, NOW), results);
  assert.ok(!md.includes('ghp_SECRETVALUE'));
  assert.match(md, /\| a\/x \| reachable \|/);
});

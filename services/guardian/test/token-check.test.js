import test from 'node:test';
import assert from 'node:assert/strict';
import { assess, parseExpiry, probe, summaryMarkdown, FAIL_DAYS, WARN_DAYS } from '../src/token-check.js';

const NOW = new Date('2026-10-17T12:00:00Z');
const day = (n) => new Date(NOW.getTime() + n * 86400000).toISOString().slice(0, 10) + ' 00:00:00 UTC';
const good = (repos) => repos.map((repo) => ({ repo, read: 200, write: 422 }));

test('parseExpiry reads GitHub\'s header format and rejects anything else', () => {
  assert.equal(parseExpiry('2026-11-25 00:00:00 UTC').toISOString(), '2026-11-25T00:00:00.000Z');
  assert.equal(parseExpiry('2026-11-25T08:30:00Z').toISOString(), '2026-11-25T08:30:00.000Z');
  for (const bad of [null, undefined, '', 'tomorrow', '25/11/2026', 42]) assert.equal(parseExpiry(bad), null);
});

test('a token with plenty of time that can create issues everywhere is OK', () => {
  const v = assess({ results: good(['a/x', 'a/y']), expiryHeader: day(60) }, NOW);
  assert.equal(v.level, 'ok');
  assert.ok(v.daysLeft >= 59);
  assert.deepEqual(v.findings, []);
});

test('it warns inside the warning window and FAILS inside the last week', () => {
  assert.equal(assess({ results: good(['a/x']), expiryHeader: day(WARN_DAYS) }, NOW).level, 'warn');
  assert.equal(assess({ results: good(['a/x']), expiryHeader: day(FAIL_DAYS) }, NOW).level, 'fail');
  assert.equal(assess({ results: good(['a/x']), expiryHeader: day(-1) }, NOW).level, 'fail');
  assert.match(assess({ results: good(['a/x']), expiryHeader: day(-1) }, NOW).findings[0], /already/);
});

test('HTTP 401 everywhere means the token is dead', () => {
  const v = assess({ results: [{ repo: 'a/x', read: 401, write: 401 }, { repo: 'a/y', read: 401, write: 401 }], expiryHeader: null }, NOW);
  assert.equal(v.level, 'fail');
  assert.match(v.findings[0], /expired or revoked/);
});

test('repositories where the token cannot CREATE issues are named, as a warning', () => {
  // Reading public issues works for any valid token, so reads say nothing; the write probe is the signal.
  const v = assess({
    results: [
      { repo: 'a/mines', read: 200, write: 422 },
      { repo: 'a/forms', read: 200, write: 403 },
      { repo: 'a/sheet', read: 200, write: 404 },
    ],
    expiryHeader: day(90),
  }, NOW);
  assert.equal(v.level, 'warn');
  assert.match(v.findings.join(' '), /cannot create issues in 2 of 3 enrolled repositories: a\/forms, a\/sheet/);
});

test('no expiry header is reported plainly and is not a failure', () => {
  const v = assess({ results: good(['a/x']), expiryHeader: null }, NOW);
  assert.equal(v.level, 'ok');
  assert.match(v.findings[0], /no expiry/);
});

test('a network error is flagged as unexpected, never a crash and never a silent pass', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/a/boom/')) throw new Error('socket hang up');
    return { status: url.endsWith('/issues') ? 422 : 200, headers: new Headers({ 'github-authentication-token-expiration': day(30) }) };
  };
  const { results, expiryHeader } = await probe({ token: 't', repos: ['a/ok', 'a/boom'], fetchImpl });
  assert.deepEqual(results, [{ repo: 'a/ok', read: 200, write: 422 }, { repo: 'a/boom', read: 0, write: 0 }]);
  assert.equal(expiryHeader, day(30));
  const v = assess({ results, expiryHeader }, NOW);
  assert.equal(v.level, 'warn');
  assert.match(v.findings.join(' '), /Unexpected answers from GitHub for a\/boom/);
});

test('the write probe can never create an issue: its body is never a valid issue', async () => {
  const posts = [];
  const fetchImpl = async (url, options) => {
    if (options.method === 'POST') posts.push({ url, body: JSON.parse(options.body), auth: options.headers.Authorization });
    return { status: options.method === 'POST' ? 422 : 200, headers: new Headers() };
  };
  await probe({ token: 'ghp_SECRETVALUE', repos: ['a/x', 'a/y'], fetchImpl });

  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.match(post.url, /^https:\/\/api\.github\.com\/repos\/a\/[xy]\/issues$/);
    assert.ok(Array.isArray(post.body.title), 'an array title is rejected by GitHub as invalid, so nothing is created');
    assert.deepEqual(Object.keys(post.body), ['title']);
    assert.equal(post.auth, 'Bearer ghp_SECRETVALUE');
  }
});

test('the token never appears in the summary, which names each repository\'s access', () => {
  const results = [{ repo: 'a/x', read: 200, write: 422 }, { repo: 'a/y', read: 200, write: 403 }];
  const md = summaryMarkdown(assess({ results, expiryHeader: null }, NOW), results);
  assert.ok(!md.includes('ghp_'));
  assert.match(md, /\| a\/x \| ok \| can create issues \|/);
  assert.match(md, /\| a\/y \| ok \| CANNOT create issues \|/);
});

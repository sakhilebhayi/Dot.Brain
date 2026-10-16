// services/platform-collector/test/fetch.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fetchHealth, FAILURE_KINDS, VALID_STATUSES } from '../src/fetch.js';

const MANIFEST = {
  platform: 'dot-mines',
  health_url: 'https://mines.test/guardian/health',
  token_env: 'MINES_TOKEN',
  timeout_ms: 15000,
};
const ENV = { MINES_TOKEN: 'tok-1' };

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const failing = (status) => ({ ok: false, status });

const GOOD_DOC = {
  platform: 'dot-mines',
  contract: 'dot-guardian/v1',
  generated_at: '2026-10-16T19:00:00Z',
  status: 'warning',
  checks: { queue: { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } } },
};

test('the vocabularies match ADR-0016 / Guardian', () => {
  assert.deepEqual(VALID_STATUSES, ['healthy', 'warning', 'critical', 'unknown']);
  assert.deepEqual(FAILURE_KINDS, ['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract']);
});

test('fetchHealth sends the bearer token to the manifest URL and returns the document', async () => {
  let seenUrl;
  let seenHeaders;
  const fetchImpl = async (url, options) => {
    seenUrl = url;
    seenHeaders = options.headers;
    return ok(GOOD_DOC);
  };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.deepEqual(result, {
    reachable: true,
    status: 'warning',
    generated_at: '2026-10-16T19:00:00Z',
    checks: GOOD_DOC.checks,
  });
  assert.equal(seenUrl, MANIFEST.health_url);
  assert.equal(seenHeaders.Authorization, 'Bearer tok-1');
});

test('fetchHealth records an unset token as kind config without calling fetch', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: {} });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'config');
  assert.match(result.reason, /MINES_TOKEN/);
  assert.equal(called, false);
});

test('fetchHealth classifies HTTP statuses', async () => {
  const cases = [[401, 'access'], [403, 'access'], [404, 'config'], [503, 'maintenance'], [500, 'platform_error'], [502, 'platform_error'], [429, 'access']];
  for (const [status, kind] of cases) {
    const result = await fetchHealth(MANIFEST, { fetchImpl: async () => failing(status), env: ENV });
    assert.equal(result.reachable, false);
    assert.equal(result.kind, kind, `HTTP ${status}`);
    assert.match(result.reason, new RegExp(`HTTP ${status}`));
  }
});

test('fetchHealth classifies a thrown fetch as unreachable', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'unreachable');
  assert.match(result.reason, /ECONNREFUSED/);
});

test('fetchHealth classifies a non-JSON body as contract', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.kind, 'contract');
  assert.match(result.reason, /not JSON/);
});

test('fetchHealth classifies a body that is not dot-guardian/v1-shaped as contract', async () => {
  const bad = [
    null,
    {},
    { status: 'healthy' },
    { status: 'great', checks: {} },
    { status: 'healthy', checks: null },
    { status: 'healthy', checks: [] },
  ];
  for (const body of bad) {
    const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(body), env: ENV });
    assert.equal(result.reachable, false, JSON.stringify(body));
    assert.equal(result.kind, 'contract', JSON.stringify(body));
  }
});

test('fetchHealth reports a missing or non-string generated_at as null', async () => {
  const doc = { status: 'healthy', checks: {}, generated_at: 12345 };
  const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(doc), env: ENV });
  assert.equal(result.reachable, true);
  assert.equal(result.generated_at, null);
});

test('fetchHealth classifies a body read that times out as unreachable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); },
  });
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'unreachable');
  assert.match(result.reason, /body read failed/);
});

test('fetchHealth classifies a body read that is aborted as unreachable', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => { throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }); },
  });
  const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'unreachable');
  assert.match(result.reason, /body read failed/);
});

test('fetchHealth names the underlying cause of an undici "fetch failed"', async () => {
  const refused = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); };
  const dns = async () => { throw Object.assign(new Error('fetch failed'), { cause: new Error('getaddrinfo ENOTFOUND mines.test') }); };
  const bare = async () => { throw new Error('fetch failed'); };

  const a = await fetchHealth(MANIFEST, { fetchImpl: refused, env: ENV });
  const b = await fetchHealth(MANIFEST, { fetchImpl: dns, env: ENV });
  const c = await fetchHealth(MANIFEST, { fetchImpl: bare, env: ENV });
  assert.equal(a.kind, 'unreachable');
  assert.equal(a.reason, 'fetch failed: fetch failed (ECONNREFUSED)');
  assert.equal(b.reason, 'fetch failed: fetch failed (getaddrinfo ENOTFOUND mines.test)');
  assert.equal(c.reason, 'fetch failed: fetch failed');
});

test('fetchHealth never throws, whatever the fetch rejects with or resolves to', async () => {
  const cases = {
    'rejects with null': async () => { throw null; },
    'rejects with undefined': async () => { throw undefined; },
    'rejects with a string': async () => { throw 'socket hang up'; },
    'resolves undefined': async () => undefined,
    'resolves null': async () => null,
  };
  for (const [name, fetchImpl] of Object.entries(cases)) {
    const result = await fetchHealth(MANIFEST, { fetchImpl, env: ENV });
    assert.equal(result.reachable, false, name);
    assert.equal(result.kind, 'unreachable', name);
    assert.equal(typeof result.reason, 'string', name);
  }
  const string = await fetchHealth(MANIFEST, { fetchImpl: cases['rejects with a string'], env: ENV });
  assert.match(string.reason, /socket hang up/);
  const empty = await fetchHealth(MANIFEST, { fetchImpl: cases['resolves undefined'], env: ENV });
  assert.match(empty.reason, /no response/);
});

test('fetchHealth rejects a document that is for a different platform', async () => {
  const doc = { ...GOOD_DOC, platform: 'blupin' };
  const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(doc), env: ENV });
  assert.equal(result.reachable, false);
  assert.equal(result.kind, 'contract');
  assert.equal(result.reason, 'document is for "blupin", not "dot-mines"');
});

test('fetchHealth clips an over-long platform in the mismatch reason', async () => {
  const doc = { ...GOOD_DOC, platform: 'p'.repeat(5000) };
  const result = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(doc), env: ENV });
  assert.equal(result.kind, 'contract');
  assert.equal(result.reason, `document is for "${'p'.repeat(64)}", not "dot-mines"`);
});

test('fetchHealth accepts a document with no platform field, or the matching one', async () => {
  const { platform, ...withoutPlatform } = GOOD_DOC;
  const absent = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(withoutPlatform), env: ENV });
  assert.equal(absent.reachable, true);
  const match = await fetchHealth(MANIFEST, { fetchImpl: async () => ok(GOOD_DOC), env: ENV });
  assert.equal(match.reachable, true);
});

test('fetchHealth gives up on a real server that stalls mid-body, as unreachable and within the timeout', async () => {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"status":"hea');
    // never finishes the body
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const manifest = {
      platform: 'x',
      health_url: `http://127.0.0.1:${server.address().port}/`,
      token_env: 'T',
      timeout_ms: 300,
    };
    const started = Date.now();
    const result = await fetchHealth(manifest, { env: { T: 't' } });
    const elapsed = Date.now() - started;
    assert.equal(result.reachable, false);
    assert.equal(result.kind, 'unreachable');
    assert.match(result.reason, /body read failed/);
    assert.ok(elapsed < 3000, `took ${elapsed} ms`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

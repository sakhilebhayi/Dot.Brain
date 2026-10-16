// services/platform-collector/test/fetch.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
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

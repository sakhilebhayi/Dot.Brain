// services/platform-collector/test/memory.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryConfig, writeObservation } from '../src/memory.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };
const RECORD = { event_id: 'collect-dot-mines-2026101619', detail: {} };

const reply = (status) => ({ ok: status >= 200 && status < 300, status, json: async () => ({}) });

test('memoryConfig is disabled when either env var is missing', () => {
  assert.deepEqual(memoryConfig({}), { enabled: false });
  assert.deepEqual(memoryConfig({ DOT_MEMORY_URL: 'https://m.test' }), { enabled: false });
  assert.deepEqual(memoryConfig({ DOT_MEMORY_TOKEN: 't' }), { enabled: false });
});

test('memoryConfig is enabled and strips trailing slashes', () => {
  assert.deepEqual(
    memoryConfig({ DOT_MEMORY_URL: 'https://m.test//', DOT_MEMORY_TOKEN: 't' }),
    { enabled: true, url: 'https://m.test', token: 't' },
  );
});

test('writeObservation posts the record to the events endpoint with the bearer token', async () => {
  let seen;
  const fetchImpl = async (url, options) => {
    seen = { url, options };
    return reply(201);
  };
  const result = await writeObservation(CFG, RECORD, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, attempts: 1 });
  assert.equal(seen.url, 'https://memory.test/api/intelligence/events');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.Authorization, 'Bearer tok');
  assert.equal(seen.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.options.body), RECORD);
});

test('writeObservation accepts 200 (an idempotent update) as success', async () => {
  const result = await writeObservation(CFG, RECORD, { fetchImpl: async () => reply(200), sleep: async () => {} });
  assert.equal(result.ok, true);
});

test('writeObservation reports not-ok without calling fetch when Memory is disabled', async () => {
  let called = false;
  const result = await writeObservation({ enabled: false }, RECORD, { fetchImpl: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
  assert.equal(called, false);
});

test('writeObservation retries a 5xx after the configured delay and then succeeds', async () => {
  const replies = [reply(502), reply(201)];
  const slept = [];
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => replies.shift(),
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.deepEqual(result, { ok: true, attempts: 2 });
  assert.deepEqual(slept, [2000]);
});

test('writeObservation retries a thrown network error', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('ECONNRESET');
    return reply(201);
  };
  const result = await writeObservation(CFG, RECORD, { fetchImpl, sleep: async () => {} });
  assert.deepEqual(result, { ok: true, attempts: 2 });
});

test('writeObservation gives up after the final delay and reports the last failure', async () => {
  const slept = [];
  let calls = 0;
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => { calls += 1; return reply(500); },
    sleep: async (ms) => { slept.push(ms); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 3);
  assert.match(result.reason, /HTTP 500/);
  assert.equal(calls, 3);
  assert.deepEqual(slept, [2000, 5000]);
});

test('writeObservation does not retry a 4xx', async () => {
  let calls = 0;
  const result = await writeObservation(CFG, RECORD, {
    fetchImpl: async () => { calls += 1; return reply(422); },
    sleep: async () => { throw new Error('must not sleep'); },
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.match(result.reason, /HTTP 422/);
  assert.equal(calls, 1);
});

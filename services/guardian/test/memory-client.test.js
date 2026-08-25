import test from 'node:test';
import assert from 'node:assert/strict';
import { flush, memoryConfig, recall, record, toMemoryRecord } from '../src/memory-client.js';
import { listMemoryOutbox } from '../src/store.js';
import { fakeFetch, jsonResponse, manifest, tempStore } from './helpers.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

const INCIDENT = {
  incident_uid: 'grd-dot-mines-1',
  platform: 'dot-mines',
  check_key: 'queue',
  signature: 'dot-mines:queue:critical',
  severity: 'sev2',
  status: 'open',
  attempts: 0,
  first_seen: '2026-08-25T10:00:00Z',
  resolved_at: null,
  detail: '{"check":"queue"}',
};

test('memoryConfig is disabled without url and token', () => {
  assert.equal(memoryConfig({}).enabled, false);
  assert.equal(memoryConfig({ DOT_MEMORY_URL: 'https://m', DOT_MEMORY_TOKEN: 't' }).enabled, true);
});

test('toMemoryRecord maps incident rows to the ops-memory shape', () => {
  const payload = toMemoryRecord(INCIDENT, manifest(), { deploy_result: 'success' });
  assert.equal(payload.incident_uid, 'grd-dot-mines-1');
  assert.equal(payload.component, 'queue');
  assert.equal(payload.detection_source, 'guardian-health-poll');
  assert.equal(payload.deploy_result, 'success');
  assert.deepEqual(payload.record.detail, { check: 'queue' });
});

test('record posts to Dot.Memory with the bearer token', async () => {
  const fetchImpl = fakeFetch({ 'https://memory.test/api/ops/incidents': jsonResponse({ data: {} }, 201) });
  const store = tempStore();

  const result = await record(CFG, store, toMemoryRecord(INCIDENT, manifest()), fetchImpl);

  assert.equal(result.ok, true);
  assert.equal(fetchImpl.calls[0].options.headers.Authorization, 'Bearer tok');
  assert.equal(listMemoryOutbox(store).length, 0);
});

test('a failed record lands in the outbox and flush retries it', async () => {
  const store = tempStore();
  const failing = fakeFetch({ 'https://memory.test': () => jsonResponse({}, 500) });

  const result = await record(CFG, store, toMemoryRecord(INCIDENT, manifest()), failing);
  assert.equal(result.ok, false);
  assert.equal(result.queued, true);
  assert.equal(listMemoryOutbox(store).length, 1);

  const working = fakeFetch({ 'https://memory.test': jsonResponse({ data: {} }) });
  const flushed = await flush(CFG, store, working);
  assert.equal(flushed.flushed, 1);
  assert.equal(flushed.remaining, 0);
});

test('flush stops at the first failure to preserve ordering', async () => {
  const store = tempStore();
  const failing = fakeFetch({ 'https://memory.test': () => jsonResponse({}, 500) });
  await record(CFG, store, { a: 1 }, failing);
  await record(CFG, store, { a: 2 }, failing);

  const stillFailing = await flush(CFG, store, failing);
  assert.equal(stillFailing.flushed, 0);
  assert.equal(stillFailing.remaining, 2);
});

test('recall returns the summary payload', async () => {
  const fetchImpl = fakeFetch({
    'https://memory.test/api/ops/recall': { data: { matches: 4, success_rate: 0.75 } },
  });

  const result = await recall(CFG, { platform: 'dot-mines', signature: 'sig' }, fetchImpl);
  assert.equal(result.matches, 4);
  assert.match(fetchImpl.calls[0].url, /signature=sig/);
});

test('recall degrades to zero history when Dot.Memory is down', async () => {
  const fetchImpl = fakeFetch({ 'https://memory.test': () => jsonResponse({}, 503) });
  const result = await recall(CFG, { platform: 'dot-mines', signature: 'sig' }, fetchImpl);
  assert.equal(result.matches, 0);
  assert.equal(result.unavailable, true);
});

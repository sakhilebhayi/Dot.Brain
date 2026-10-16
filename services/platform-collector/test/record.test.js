import test from 'node:test';
import assert from 'node:assert/strict';
import { buildObservation } from '../src/record.js';

const MANIFEST = { platform: 'dot-mines' };
const NOW = new Date('2026-10-16T19:17:42.000Z');

const UP = {
  reachable: true,
  status: 'warning',
  generated_at: '2026-10-16T19:17:00Z',
  checks: {
    queue: { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } },
    integration_sync: { status: 'warning', message: 'slow', metrics: {} },
  },
};
const DOWN = { reachable: false, kind: 'maintenance', reason: 'HTTP 503' };

test('the envelope carries every field Dot.Memory requires, with the documented values', () => {
  const record = buildObservation(MANIFEST, UP, NOW);
  assert.equal(record.loop_id, 'collect-dot-mines-2026-10-16');
  assert.equal(record.event_id, 'collect-dot-mines-2026101619');
  assert.equal(record.platform, 'dot-brain');
  assert.equal(record.source, 'platform-collector');
  assert.equal(record.subject_type, 'platform');
  assert.equal(record.subject_id, 'dot-mines');
  assert.equal(record.subject_label, 'dot-mines hourly state');
  assert.equal(record.occurred_at, '2026-10-16T19:17:42.000Z');
  assert.equal(record.signature, 'status:warning');
});

test('every string in the envelope fits Dot.Memory\'s 255-character limit', () => {
  const huge = { reachable: false, kind: 'contract', reason: 'x'.repeat(5000) };
  const record = buildObservation(MANIFEST, huge, NOW);
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') assert.ok(value.length <= 255, `${key} is ${value.length} chars`);
  }
});

test('a reachable document is summarised in detail', () => {
  const { detail } = buildObservation(MANIFEST, UP, NOW);
  assert.equal(detail.reachable, true);
  assert.equal(detail.status, 'warning');
  assert.equal(detail.kind, null);
  assert.equal(detail.reason, null);
  assert.equal(detail.generated_at, '2026-10-16T19:17:00Z');
  assert.equal(detail.check_count, 2);
  assert.deepEqual(detail.checks.queue, { status: 'healthy', message: 'ok', metrics: { pending_jobs: 3 } });
});

test('a failure is recorded as data, with a failure signature', () => {
  const record = buildObservation(MANIFEST, DOWN, NOW);
  assert.equal(record.signature, 'failure:maintenance');
  assert.equal(record.detail.reachable, false);
  assert.equal(record.detail.status, null);
  assert.equal(record.detail.kind, 'maintenance');
  assert.equal(record.detail.reason, 'HTTP 503');
  assert.equal(record.detail.generated_at, null);
  assert.equal(record.detail.check_count, 0);
  assert.deepEqual(record.detail.checks, {});
});

test('event_id is stable within a UTC hour and changes across hours', () => {
  const a = buildObservation(MANIFEST, UP, new Date('2026-10-16T19:00:01.000Z'));
  const b = buildObservation(MANIFEST, UP, new Date('2026-10-16T19:59:59.000Z'));
  const c = buildObservation(MANIFEST, UP, new Date('2026-10-16T20:00:00.000Z'));
  assert.equal(a.event_id, b.event_id);
  assert.notEqual(a.event_id, c.event_id);
});

test('loop_id changes across UTC days', () => {
  const a = buildObservation(MANIFEST, UP, new Date('2026-10-16T23:59:00.000Z'));
  const b = buildObservation(MANIFEST, UP, new Date('2026-10-17T00:01:00.000Z'));
  assert.notEqual(a.loop_id, b.loop_id);
});

test('long messages are truncated to 240 characters', () => {
  const result = { ...UP, checks: { queue: { status: 'healthy', message: 'm'.repeat(1000), metrics: {} } } };
  assert.equal(buildObservation(MANIFEST, result, NOW).detail.checks.queue.message.length, 240);
});

test('only scalar metrics survive; strings are clipped; objects, arrays, null and non-finite numbers are dropped', () => {
  const metrics = {
    count: 3,
    ratio: 0.5,
    flag: true,
    label: 's'.repeat(1000),
    nested: { a: 1 },
    list: [1, 2],
    nothing: null,
    nan: NaN,
    inf: Infinity,
  };
  const result = { ...UP, checks: { queue: { status: 'healthy', message: '', metrics } } };
  const kept = buildObservation(MANIFEST, result, NOW).detail.checks.queue.metrics;
  assert.deepEqual(Object.keys(kept).sort(), ['count', 'flag', 'label', 'ratio']);
  assert.equal(kept.label.length, 240);
});

test('at most 32 metric keys are kept per check', () => {
  const metrics = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  const result = { ...UP, checks: { queue: { status: 'healthy', message: '', metrics } } };
  assert.equal(Object.keys(buildObservation(MANIFEST, result, NOW).detail.checks.queue.metrics).length, 32);
});

test('at most 64 checks are kept but check_count reports the true number', () => {
  const checks = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`c${i}`, { status: 'healthy', message: '', metrics: {} }]));
  const { detail } = buildObservation(MANIFEST, { ...UP, checks }, NOW);
  assert.equal(detail.check_count, 100);
  assert.equal(Object.keys(detail.checks).length, 64);
});

test('an invalid check status becomes unknown and a non-string message becomes empty', () => {
  const result = { ...UP, checks: { queue: { status: 'great', message: 42, metrics: 'nope' } } };
  assert.deepEqual(buildObservation(MANIFEST, result, NOW).detail.checks.queue, { status: 'unknown', message: '', metrics: {} });
});

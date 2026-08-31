import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContextRecord } from '../src/record.js';

test('record joins the BluPin loop and is idempotent by construction', () => {
  const r = buildContextRecord('2026-09-04', [{ title: 'NFP' }],
    new Date('2026-09-04T03:05:00Z'));
  assert.equal(r.loop_id, 'blupin-gold-2026-09-04');
  assert.equal(r.event_id, 'blupin-gold-2026-09-04-news');
  assert.equal(r.subject_type, 'trading-signal');
  assert.equal(r.subject_id, 'gold-2026-09-04');
  assert.equal(r.platform, 'dot-brain');
  assert.equal(r.signature, 'usd-news-calendar');
  assert.equal(r.detail.count, 1);
  assert.equal(r.occurred_at, '2026-09-04T03:05:00.000Z');
});

test('a quiet day is still a record (zero events is context too)', () => {
  const r = buildContextRecord('2026-09-07', []);
  assert.equal(r.detail.count, 0);
  assert.deepEqual(r.detail.events, []);
});

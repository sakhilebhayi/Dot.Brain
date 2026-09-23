import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOpportunities, CHURN_RATE_THRESHOLD } from '../src/opportunities.js';

const BASE = {
  platform: 'dot-billing',
  generated_at: '2026-09-23T10:00:00.000Z',
  classification: 'restricted',
};

test('detects MRR decline when trend is down', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /MRR is trending down for dot-billing/);
  assert.equal(result[0].domain, 'revenue');
  assert.equal(result[0].scope, 'dot-billing');
  assert.equal(result[0]['x-classification'], 'restricted');
});

test('does not flag MRR when trend is up', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'up' }] });
  assert.equal(result.length, 0);
});

test('detects a high churn rate above the threshold', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.churn_rate', value: 0.08 }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /Churn rate \(0\.08\) exceeds/);
});

test('does not flag churn rate at or below the threshold', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.churn_rate', value: CHURN_RATE_THRESHOLD }] });
  assert.equal(result.length, 0);
});

test('detects a rising payout delay', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'finance.payout_delay_p50', value: 3, trend: 'up' }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /Payout delay is trending up/);
});

test('does not flag payout delay when trend is down', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'finance.payout_delay_p50', value: 3, trend: 'down' }] });
  assert.equal(result.length, 0);
});

test('an unrecognized signal key produces no insight', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.arr', value: 500000 }] });
  assert.equal(result.length, 0);
});

test('an empty signals array produces no insights', () => {
  const result = detectOpportunities({ ...BASE, signals: [] });
  assert.equal(result.length, 0);
});

test('multiple matching signals each produce their own insight', () => {
  const result = detectOpportunities({
    ...BASE,
    signals: [
      { key: 'revenue.mrr', value: 1000, trend: 'down' },
      { key: 'revenue.churn_rate', value: 0.1 },
    ],
  });
  assert.equal(result.length, 2);
});

test('evidence references the triggering signal, platform, and generated_at, with kind external', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result[0].evidence, [{ kind: 'external', reference: 'dot-billing:revenue.mrr@2026-09-23T10:00:00.000Z' }]);
});

test('valid_until is 24 hours after generated_at', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.equal(result[0].valid_until, '2026-09-24T10:00:00.000Z');
});

test('a missing generated_at produces no insights instead of throwing', () => {
  const { generated_at, ...withoutGeneratedAt } = BASE;
  const result = detectOpportunities({ ...withoutGeneratedAt, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result, []);
});

test('an invalid generated_at produces no insights instead of throwing', () => {
  const result = detectOpportunities({ ...BASE, generated_at: 'not-a-date', signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result, []);
});

test('a null generated_at produces no insights instead of a 1970 insight', () => {
  const result = detectOpportunities({ ...BASE, generated_at: null, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result, []);
});

test('a numeric generated_at produces no insights instead of a 1970 insight', () => {
  const result = detectOpportunities({ ...BASE, generated_at: 1758621600000, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result, []);
});

test('a generated_at too close to Date\'s range limit for +24h produces no insights instead of throwing', () => {
  const result = detectOpportunities({ ...BASE, generated_at: '+275760-09-13T00:00:00.000Z', signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result, []);
});

test('a missing signals array produces no insights instead of throwing', () => {
  const { signals, ...withoutSignals } = BASE;
  const result = detectOpportunities({ ...withoutSignals });
  assert.deepEqual(result, []);
});

test('a non-array signals field produces no insights instead of throwing', () => {
  const result = detectOpportunities({ ...BASE, signals: 'not-an-array' });
  assert.deepEqual(result, []);
});

test('a null entry in signals is skipped instead of throwing', () => {
  const result = detectOpportunities({ ...BASE, signals: [null, { key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.equal(result.length, 1);
});

test('a null pollResult produces no insights instead of throwing', () => {
  assert.deepEqual(detectOpportunities(null), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSignalsResponse, classificationExceedsCeiling, CLASSIFICATIONS } from '../src/contract.js';

const VALID_BODY = {
  platform: 'dot-billing',
  contract: 'dot-revenue/v1',
  generated_at: '2026-09-23T10:00:00Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 48210.55, unit: 'usd' }],
};

test('CLASSIFICATIONS is ordered least to most restrictive', () => {
  assert.deepEqual(CLASSIFICATIONS, ['public', 'ecosystem', 'restricted', 'sensitive']);
});

test('validateSignalsResponse accepts a well-formed body', () => {
  assert.deepEqual(validateSignalsResponse(VALID_BODY), { valid: true });
});

test('validateSignalsResponse rejects a non-object body', () => {
  const result = validateSignalsResponse(null);
  assert.equal(result.valid, false);
  assert.match(result.reason, /not an object/);
});

test('validateSignalsResponse rejects a missing generated_at', () => {
  const { generated_at, ...withoutGeneratedAt } = VALID_BODY;
  const result = validateSignalsResponse(withoutGeneratedAt);
  assert.equal(result.valid, false);
  assert.match(result.reason, /generated_at must be a valid ISO date-time string/);
});

test('validateSignalsResponse rejects a non-string generated_at', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, generated_at: 12345 });
  assert.equal(result.valid, false);
  assert.match(result.reason, /generated_at must be a valid ISO date-time string/);
});

test('validateSignalsResponse rejects an unparseable generated_at', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, generated_at: 'not-a-date' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /generated_at must be a valid ISO date-time string/);
});

test('validateSignalsResponse rejects a missing classification', () => {
  const { classification, ...withoutClassification } = VALID_BODY;
  const result = validateSignalsResponse(withoutClassification);
  assert.equal(result.valid, false);
  assert.match(result.reason, /classification must be one of/);
});

test('validateSignalsResponse rejects an unknown classification value', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, classification: 'top-secret' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /classification must be one of/);
});

test('validateSignalsResponse rejects a non-array signals field', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: 'not-an-array' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals must be an array/);
});

test('validateSignalsResponse rejects a signal missing key or value', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: [{ unit: 'usd' }] });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals\[0\]/);
});

test('validateSignalsResponse rejects a signal with a null value', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: [{ key: 'revenue.mrr', value: null }] });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals\[0\]/);
});

test('validateSignalsResponse rejects a signal with a non-numeric value', () => {
  for (const value of [true, 'usd', [0.9], { a: 1 }]) {
    const result = validateSignalsResponse({ ...VALID_BODY, signals: [{ key: 'revenue.mrr', value }] });
    assert.equal(result.valid, false, `expected ${JSON.stringify(value)} to be rejected`);
    assert.match(result.reason, /signals\[0\]/);
  }
});

test('validateSignalsResponse rejects a signal with a non-string key', () => {
  const result = validateSignalsResponse({ ...VALID_BODY, signals: [{ key: { nope: true }, value: 48210.55 }] });
  assert.equal(result.valid, false);
  assert.match(result.reason, /signals\[0\]/);
});

test('validateSignalsResponse accepts multiple well-formed signals', () => {
  const result = validateSignalsResponse({
    ...VALID_BODY,
    signals: [
      { key: 'revenue.mrr', value: 48210.55 },
      { key: 'revenue.churn_rate', value: 0.021 },
    ],
  });
  assert.deepEqual(result, { valid: true });
});

test('classificationExceedsCeiling is false when classification is at or below the ceiling', () => {
  assert.equal(classificationExceedsCeiling('ecosystem', 'restricted'), false);
  assert.equal(classificationExceedsCeiling('restricted', 'restricted'), false);
  assert.equal(classificationExceedsCeiling('public', 'restricted'), false);
});

test('classificationExceedsCeiling is true when classification exceeds the ceiling', () => {
  assert.equal(classificationExceedsCeiling('sensitive', 'restricted'), true);
});

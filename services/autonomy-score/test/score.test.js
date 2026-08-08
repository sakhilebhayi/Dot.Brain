import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntity, averageScore } from '../src/score.js';

function signals(overrides = {}) {
  return {
    entity: 'test-entity',
    kind: 'platform',
    level_1_count: 0,
    level_2_count: 0,
    has_cicd: false,
    has_cushion_dimension: false,
    has_security_ci_check: false,
    verified_infrastructure_pass: false,
    audited_date: '2026-08-08',
    ...overrides,
  };
}

test('scoreEntity() with all-zero signals returns 0 for every category and a total of 0', () => {
  const result = scoreEntity(signals());
  assert.equal(result.categories.governance, 0);
  assert.equal(result.categories.operations, 0);
  assert.equal(result.categories.technology, 0);
  assert.equal(result.categories.marketing, 0);
  assert.equal(result.categories.sales, 0);
  assert.equal(result.categories.customer_experience, 0);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.categories.security, 0);
  assert.equal(result.categories.resilience, 0);
  assert.equal(result.categories.knowledge, 0);
  assert.equal(result.categories.learning, 0);
  assert.equal(result.total, 0);
});

test('scoreEntity() sets governance to 100 only when level_2_count > 0', () => {
  const result = scoreEntity(signals({ level_2_count: 3 }));
  assert.equal(result.categories.governance, 100);
  assert.equal(result.total, 10); // 10% weight, nothing else set
});

test('scoreEntity() sets operations to 100 only when level_1_count > 0', () => {
  const result = scoreEntity(signals({ level_1_count: 1 }));
  assert.equal(result.categories.operations, 100);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets technology to 100 only when has_cicd is true', () => {
  const result = scoreEntity(signals({ has_cicd: true }));
  assert.equal(result.categories.technology, 100);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets security to 100 only when has_security_ci_check is true, independent of has_cicd', () => {
  const result = scoreEntity(signals({ has_security_ci_check: true }));
  assert.equal(result.categories.security, 100);
  assert.equal(result.categories.technology, 0);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets resilience to 100 only when has_cushion_dimension is true, and finance stays 0', () => {
  const result = scoreEntity(signals({ has_cushion_dimension: true }));
  assert.equal(result.categories.resilience, 100);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets knowledge to 100 only when verified_infrastructure_pass is true (5% weight)', () => {
  const result = scoreEntity(signals({ verified_infrastructure_pass: true }));
  assert.equal(result.categories.knowledge, 100);
  assert.equal(result.total, 5);
});

test('scoreEntity() marketing, sales, customer_experience, finance, learning are always 0 regardless of input', () => {
  const result = scoreEntity(signals({ level_1_count: 99, level_2_count: 99, has_cicd: true, has_cushion_dimension: true, has_security_ci_check: true, verified_infrastructure_pass: true }));
  assert.equal(result.categories.marketing, 0);
  assert.equal(result.categories.sales, 0);
  assert.equal(result.categories.customer_experience, 0);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.categories.learning, 0);
});

test('scoreEntity() with every real signal true sums to the full 90% (all 100-weighted categories) since marketing/sales/CX/finance/learning stay 0', () => {
  const result = scoreEntity(signals({ level_1_count: 1, level_2_count: 1, has_cicd: true, has_cushion_dimension: true, has_security_ci_check: true, verified_infrastructure_pass: true }));
  // governance 10 + operations 10 + technology 10 + security 10 + resilience 10 + knowledge 5 = 55
  assert.equal(result.total, 55);
});

test('averageScore() computes the unweighted mean of a list of totals, rounded to 1 decimal', () => {
  assert.equal(averageScore([0, 10, 20]), 10);
  assert.equal(averageScore([0, 0, 10]), 3.3);
});

test('averageScore() of an empty list returns 0, not NaN or a thrown error', () => {
  assert.equal(averageScore([]), 0);
});

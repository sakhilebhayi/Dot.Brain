import test from 'node:test';
import assert from 'node:assert/strict';
import { runEthicsGate, runSecurityGate, PROHIBITED_TARGET_METRICS } from '../src/gates.js';

test('an insight with no declared target metric passes the ethics gate', () => {
  const result = runEthicsGate({ statement: 'MRR is trending down.' });
  assert.equal(result.passed, true);
});

test('an insight declaring a prohibited target metric fails the ethics gate', () => {
  const result = runEthicsGate({ statement: 'x', targetMetric: 'app_open_count' });
  assert.equal(result.passed, false);
  assert.match(result.reason, /app_open_count/);
});

test('every prohibited metric in the list is individually rejected', () => {
  for (const metric of PROHIBITED_TARGET_METRICS) {
    const result = runEthicsGate({ statement: 'x', targetMetric: metric });
    assert.equal(result.passed, false, `expected ${metric} to be rejected`);
  }
});

test('a restricted insight passes the security gate for a platform cleared for restricted', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public', 'restricted']);
  assert.equal(result.passed, true);
});

test('a restricted insight fails the security gate for a public-only-cleared platform', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /not cleared/);
});

test('an insight with no declared classification defaults to public and passes for any clearance', () => {
  const result = runSecurityGate({}, ['public']);
  assert.equal(result.passed, true);
});

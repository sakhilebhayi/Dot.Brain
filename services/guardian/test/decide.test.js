import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../src/decide.js';
import { manifest } from './helpers.js';

function incident(overrides = {}) {
  return {
    incident_uid: 'grd-test-1',
    platform: 'dot-mines',
    check_key: 'queue',
    signature: 'dot-mines:queue:critical',
    severity: 'sev2',
    status: 'open',
    attempts: 0,
    ...overrides,
  };
}

test('open circuit breaker forces escalation', () => {
  const decision = evaluate({ incident: incident(), manifest: manifest(), breakerOpen: true });
  assert.equal(decision.action, 'escalate');
  assert.match(decision.reasons.join(' '), /breaker/);
});

test('exhausted attempts force escalation', () => {
  const decision = evaluate({ incident: incident({ attempts: 2 }), manifest: manifest() });
  assert.equal(decision.action, 'escalate');
  assert.match(decision.reasons.join(' '), /attempts/);
});

test('sev1 infrastructure incidents escalate instead of remediating', () => {
  const decision = evaluate({ incident: incident({ check_key: 'database', severity: 'sev1' }), manifest: manifest() });
  assert.equal(decision.action, 'escalate');
});

test('autonomy level 1 only observes', () => {
  const decision = evaluate({ incident: incident(), manifest: manifest({ autonomy_level: 1 }) });
  assert.equal(decision.action, 'observe');
});

test('no runbook means recommend at level 2+', () => {
  const decision = evaluate({ incident: incident({ check_key: 'scheduler', severity: 'sev2' }), manifest: manifest() });
  assert.equal(decision.action, 'recommend');
  assert.equal(decision.runbook, null);
});

test('autonomy level 2 recommends even with a matched runbook and strong recall', () => {
  const decision = evaluate({
    incident: incident(),
    manifest: manifest({ autonomy_level: 2 }),
    recall: { matches: 5, success_rate: 1, rolled_back: 0 },
  });
  assert.equal(decision.action, 'recommend');
  assert.equal(decision.runbook.key, 'redeploy');
});

test('level 3 with strong recall auto-remediates a low-risk runbook', () => {
  const decision = evaluate({
    incident: incident(),
    manifest: manifest(),
    recall: { matches: 3, success_rate: 0.9, rolled_back: 0 },
  });
  assert.equal(decision.action, 'auto_remediate');
  assert.equal(decision.confidence, 0.8);
  assert.equal(decision.risk, 0.2);
});

test('level 3 with no history stays below the confidence floor and recommends', () => {
  const decision = evaluate({ incident: incident(), manifest: manifest(), recall: { matches: 0 } });
  assert.equal(decision.action, 'recommend');
  assert.equal(decision.confidence, 0.5);
});

test('prior rollbacks subtract confidence', () => {
  const decision = evaluate({
    incident: incident(),
    manifest: manifest(),
    recall: { matches: 3, success_rate: 0.9, rolled_back: 1 },
  });
  assert.equal(decision.confidence, 0.6);
  assert.equal(decision.action, 'auto_remediate');
});

test('high-risk runbooks never auto-run', () => {
  const decision = evaluate({
    incident: incident({ check_key: 'error_rate' }),
    manifest: manifest(),
    recall: { matches: 5, success_rate: 1, rolled_back: 0 },
  });
  assert.equal(decision.risk, 0.5);
  assert.equal(decision.action, 'recommend');
});

test('an exhausted deploy budget downgrades to recommend', () => {
  const decision = evaluate({
    incident: incident(),
    manifest: manifest(),
    recall: { matches: 3, success_rate: 0.9, rolled_back: 0 },
    deploysLast6h: 3,
  });
  assert.equal(decision.action, 'recommend');
  assert.match(decision.reasons.join(' '), /budget/);
});

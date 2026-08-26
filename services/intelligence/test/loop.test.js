import test from 'node:test';
import assert from 'node:assert/strict';
import { runLoop } from '../src/loop.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };
const SUBJECT = { type: 'customer', id: '42', label: 'Acme Mining' };

/**
 * A stand-in for the three platforms: Memory answers context and accepts
 * writes, and the executor reports back. Recording what Memory was asked
 * to store is the point -- an unrecorded loop teaches nothing.
 */
function world({ context, memoryDown = false } = {}) {
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    if (memoryDown) {
      return { ok: false, status: 503, json: async () => ({}) };
    }
    if (String(url).includes('/api/intelligence/context')) {
      return { ok: true, status: 200, json: async () => ({ data: context }) };
    }
    writes.push({ url: String(url), body: JSON.parse(options.body ?? '{}') });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  return { fetchImpl, writes };
}

const provenHistory = {
  known: true,
  what_worked: [{ action_kind: 'retention_followup', attempts: 6, graded: 6, improved: 6, worsened: 0, success_rate: 1 }],
};

test('a decision is always recorded, even when nothing is executed', async () => {
  const w = world({ context: { known: true, what_worked: [] } });

  const result = await runLoop({
    subject: SUBJECT,
    proposal: { action_kind: 'retention_followup', risk: 0.2, recommendation: 'Follow up personally.' },
    cfg: CFG,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-a',
  });

  assert.equal(result.executed, false, 'no history means no unattended action');
  const decision = w.writes.find((wr) => wr.url.includes('/decisions'));
  assert.ok(decision, 'the decision must be remembered even when it was to do nothing');
  assert.equal(decision.body.loop_id, 'loop-a');
  assert.ok(decision.body.detail.rationale.length > 0, 'the reasoning must be stored, not just the verdict');
});

test('a proven track record closes the full loop: decide, act, record both', async () => {
  const w = world({ context: provenHistory });
  const executed = [];

  const result = await runLoop({
    subject: SUBJECT,
    proposal: {
      action_kind: 'retention_followup',
      risk: 0.2,
      recommendation: 'Follow up personally.',
      executor_platform: 'dot-dopemine',
      mechanic_ref: 'mech:milestone-recognition',
    },
    policy: { autonomy_ceiling: 'autonomous' },
    cfg: CFG,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-b',
    execute: async (payload) => {
      executed.push(payload);
      return { status: 'succeeded', detail: { summary: 'Deployed milestone recognition.' } };
    },
  });

  assert.equal(result.executed, true);
  assert.equal(executed.length, 1, 'the executor ran exactly once');

  const action = w.writes.find((wr) => wr.url.includes('/actions'));
  assert.ok(action, 'what the executor did must be remembered');
  assert.equal(action.body.executor_platform, 'dot-dopemine');
  assert.equal(action.body.mechanic_ref, 'mech:milestone-recognition');
  assert.equal(action.body.execution_status, 'succeeded');
  assert.equal(action.body.loop_id, 'loop-b', 'the action belongs to the same cycle as its decision');
});

test('an unreachable Memory is not mistaken for an empty history', async () => {
  const w = world({ memoryDown: true });
  let ran = false;

  const result = await runLoop({
    subject: SUBJECT,
    proposal: { action_kind: 'retention_followup', risk: 0.1, recommendation: 'Follow up.' },
    policy: { autonomy_ceiling: 'autonomous' },
    cfg: CFG,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-c',
    execute: async () => { ran = true; return { status: 'succeeded' }; },
  });

  assert.equal(ran, false, 'never act confidently on evidence that was never actually read');
  assert.equal(result.decision.autonomy_level, 'observe');
  assert.match(result.decision.rationale.join(' '), /unreachable/);
});

test('an executor refusal is recorded as a refusal, not a success', async () => {
  const w = world({ context: provenHistory });

  await runLoop({
    subject: SUBJECT,
    proposal: {
      action_kind: 'retention_followup', risk: 0.2, recommendation: 'Follow up.',
      executor_platform: 'dot-dopemine', mechanic_ref: 'mech:uncertified',
    },
    policy: { autonomy_ceiling: 'autonomous' },
    cfg: CFG,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-d',
    // Dopemine refuses an uncertified mechanic; the loop must remember that.
    execute: async () => ({ status: 'refused', detail: { reason: 'mechanic not certified' } }),
  });

  const action = w.writes.find((wr) => wr.url.includes('/actions'));
  assert.equal(action.body.execution_status, 'refused');
  assert.equal(action.body.detail.reason, 'mechanic not certified');
});

test('learning changes the verdict: the same proposal is refused on a bad history and allowed on a good one', async () => {
  const bad = world({
    context: {
      known: true,
      what_worked: [{ action_kind: 'retention_followup', attempts: 4, graded: 4, improved: 0, worsened: 3, success_rate: 0 }],
    },
  });
  const good = world({ context: provenHistory });

  const proposal = {
    action_kind: 'retention_followup', risk: 0.2, recommendation: 'Follow up.',
    executor_platform: 'dot-dopemine',
  };
  const policy = { autonomy_ceiling: 'autonomous' };

  const onBad = await runLoop({ subject: SUBJECT, proposal, policy, cfg: CFG, fetchImpl: bad.fetchImpl, loopId: 'l1', execute: async () => ({ status: 'succeeded' }) });
  const onGood = await runLoop({ subject: SUBJECT, proposal, policy, cfg: CFG, fetchImpl: good.fetchImpl, loopId: 'l2', execute: async () => ({ status: 'succeeded' }) });

  assert.equal(onBad.executed, false, 'a history of making things worse must withhold autonomy');
  assert.equal(onGood.executed, true, 'a history of working must earn it');
  assert.ok(onGood.decision.confidence > onBad.decision.confidence);
});

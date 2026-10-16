import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverInsight, recordDeliveryOutcome } from '../src/deliver.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

function world() {
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    writes.push({ url: String(url), body: JSON.parse(options.body ?? '{}') });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  return { fetchImpl, writes };
}

test('deliverInsight always delivers to the admin audience, regardless of caller input', async () => {
  const w = world();
  let receivedArgs;
  const notifyClient = { deliver: async (args) => { receivedArgs = args; return { status: 'succeeded' }; } };

  const result = await deliverInsight({
    insightId: 'dot-billing:revenue.mrr@2026-09-23T10:00:00.000Z',
    targetPlatform: 'dot-billing',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  assert.equal(result.loop_id, 'loop-x');
  assert.equal(result.delivered, true);
  assert.equal(result.execution_status, 'succeeded');
  assert.equal(result.recorded, true);
  assert.equal(receivedArgs.audience, 'admin');
});

test('deliverInsight records an action envelope with all six intelligence-loop required fields', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  await deliverInsight({
    insightId: 'ins-1',
    targetPlatform: 'dot-billing',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  const action = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.ok(action, 'the action envelope must be recorded');
  for (const field of ['loop_id', 'stage', 'platform', 'subject', 'source', 'occurred_at']) {
    assert.ok(field in action.body, `action envelope is missing required field ${field}`);
  }
  assert.equal(action.body.action.kind, 'insight.deliver');
  assert.equal(action.body.action.executor_platform, 'dot-notify');
  assert.equal(action.body.action.detail.audience, 'admin');
});

test('deliverInsight reports failed execution status without throwing', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'failed', detail: { reason: 'endpoint down' } }) };

  const result = await deliverInsight({ insightId: 'ins-3', targetPlatform: 'dot-billing', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.equal(result.delivered, false);
  assert.equal(result.execution_status, 'failed');
});

test('recordDeliveryOutcome posts an outcome envelope with all six intelligence-loop required fields', async () => {
  const w = world();
  const result = await recordDeliveryOutcome(CFG, {
    loopId: 'loop-x',
    insightId: 'ins-1',
    verdict: 'improved',
    observedAt: '2026-09-23T12:00:00.000Z',
  }, w.fetchImpl);

  assert.equal(result.ok, true);
  const outcome = w.writes.find((wr) => wr.url.endsWith('/outcomes'));
  for (const field of ['loop_id', 'stage', 'platform', 'subject', 'source', 'occurred_at']) {
    assert.ok(field in outcome.body, `outcome envelope is missing required field ${field}`);
  }
  assert.equal(outcome.body.outcome.verdict, 'improved');
});

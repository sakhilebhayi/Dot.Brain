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

test('deliverInsight always emits an action envelope with executor_platform dot-notify', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  const result = await deliverInsight({
    insightId: 'ins-1',
    targetPlatform: 'dot-hr',
    scope: 'global',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  assert.equal(result.loop_id, 'loop-x');
  assert.equal(result.delivered, true);
  assert.equal(result.execution_status, 'succeeded');

  const action = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.ok(action, 'the action envelope must be recorded');
  assert.equal(action.body.stage, 'action');
  assert.equal(action.body.platform, 'dot-brain');
  assert.equal(action.body.action.kind, 'insight.deliver');
  assert.equal(action.body.action.executor_platform, 'dot-notify');
  assert.equal(action.body.action.detail.insight_id, 'ins-1');
  assert.equal(action.body.action.detail.target_platform, 'dot-hr');
  assert.equal(action.body.action.detail.scope, 'global');
});

test('deliverInsight never lets Brain choose the channel -- notifyClient.deliver receives only insight identity, not channel details', async () => {
  const w = world();
  let receivedArgs;
  const notifyClient = { deliver: async (args) => { receivedArgs = args; return { status: 'succeeded' }; } };

  await deliverInsight({ insightId: 'ins-2', targetPlatform: 'dot-emall', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.deepEqual(Object.keys(receivedArgs).sort(), ['insightId', 'scope', 'targetPlatform']);
});

test('deliverInsight reports failed execution status without throwing', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'failed', detail: { reason: 'endpoint down' } }) };

  const result = await deliverInsight({ insightId: 'ins-3', targetPlatform: 'dot-hr', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.equal(result.delivered, false);
  assert.equal(result.execution_status, 'failed');
});

test('recordDeliveryOutcome posts an outcome envelope for the loop', async () => {
  const w = world();
  const result = await recordDeliveryOutcome(CFG, {
    loopId: 'loop-x',
    insightId: 'ins-1',
    verdict: 'improved',
    observedAt: '2026-09-19T00:00:00.000Z',
  }, w.fetchImpl);

  assert.equal(result.ok, true);
  const outcome = w.writes.find((wr) => wr.url.endsWith('/outcomes'));
  assert.equal(outcome.body.loop_id, 'loop-x');
  assert.equal(outcome.body.outcome.verdict, 'improved');
});

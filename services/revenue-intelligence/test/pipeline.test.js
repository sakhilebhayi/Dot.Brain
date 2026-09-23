import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

function world() {
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    writes.push({ url: String(url), body: JSON.parse(options.body ?? '{}') });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  return { fetchImpl, writes };
}

const POLL_RESULT = {
  platform: 'dot-billing',
  generated_at: '2026-09-23T10:00:00.000Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }],
};

test('a gate-cleared candidate is recorded and delivered', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  const result = await runPipeline({
    pollResult: POLL_RESULT,
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public', 'restricted'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.delivered[0].delivered, true);
  assert.equal(result.delivered[0].recorded, true);

  const recordWrite = w.writes.find((wr) => wr.url.endsWith('/insights'));
  assert.ok(recordWrite, 'the insight must be recorded');
  assert.equal(recordWrite.body.domain, 'revenue');
  assert.equal(recordWrite.body.scope, 'dot-billing');

  const actionWrite = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.equal(actionWrite.body.action.executor_platform, 'dot-notify');
  assert.equal(actionWrite.body.action.detail.audience, 'admin');
});

test('a candidate rejected by the security gate is never recorded or delivered', async () => {
  const w = world();
  const notifyClient = { deliver: async () => { throw new Error('should not be called'); } };

  const result = await runPipeline({
    pollResult: POLL_RESULT,
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].gate, 'security');
  assert.equal(w.writes.length, 0);
});

test('a candidate whose recordInsight fails is rejected instead of delivered anyway', async () => {
  const w = world();
  let deliverCalled = false;
  const notifyClient = { deliver: async () => { deliverCalled = true; return { status: 'succeeded' }; } };
  const failingFetch = async (url) => {
    if (String(url).endsWith('/insights')) {
      return { ok: false, status: 500, json: async () => ({}) };
    }
    return w.fetchImpl(url, { body: '{}' });
  };

  const result = await runPipeline({
    pollResult: POLL_RESULT,
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public', 'restricted'],
    fetchImpl: failingFetch,
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].gate, 'record');
  assert.equal(deliverCalled, false, 'delivery must not be attempted for an insight that was never recorded');
});

test('no candidates means nothing recorded, delivered, or rejected', async () => {
  const w = world();
  const notifyClient = { deliver: async () => { throw new Error('should not be called'); } };

  const result = await runPipeline({
    pollResult: { ...POLL_RESULT, signals: [] },
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
  });

  assert.deepEqual(result, { delivered: [], rejected: [] });
});

test('multiple gate-cleared candidates are each recorded and delivered independently', async () => {
  const w = world();
  let deliverCalls = 0;
  const notifyClient = { deliver: async () => { deliverCalls++; return { status: 'succeeded' }; } };

  const result = await runPipeline({
    pollResult: {
      ...POLL_RESULT,
      signals: [
        { key: 'revenue.mrr', value: 1000, trend: 'down' },
        { key: 'revenue.churn_rate', value: 0.5 },
      ],
    },
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public', 'restricted'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 2);
  assert.equal(deliverCalls, 2);
});

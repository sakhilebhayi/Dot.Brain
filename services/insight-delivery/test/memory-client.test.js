import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryConfig, recordInsight, searchInsights, getInsight, recordAction, recordOutcome } from '../src/memory-client.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

test('memoryConfig is disabled when env vars are missing', () => {
  assert.deepEqual(memoryConfig({}), { enabled: false });
});

test('memoryConfig is enabled and strips trailing slashes when env vars are present', () => {
  assert.deepEqual(
    memoryConfig({ DOT_MEMORY_URL: 'https://memory.test/', DOT_MEMORY_TOKEN: 'tok' }),
    { enabled: true, url: 'https://memory.test', token: 'tok' },
  );
});

test('recordInsight posts to /api/intelligence/insights and reports ok', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  const result = await recordInsight(CFG, { statement: 'x', domain: 'onboarding' }, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://memory.test/api/intelligence/insights');
  assert.equal(calls[0].body.statement, 'x');
});

test('recordInsight reports not-ok with a reason when Memory is disabled', async () => {
  const result = await recordInsight({ enabled: false }, { statement: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
});

test('searchInsights queries by domain/scope/platform and returns items', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/intelligence\/insights\?domain=onboarding&scope=global&platform=dot-hr/);
    return { ok: true, status: 200, json: async () => ({ data: { items: [{ id: 'ins-1' }] } }) };
  };
  const result = await searchInsights(CFG, { domain: 'onboarding', scope: 'global', platform: 'dot-hr' }, fetchImpl);
  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
});

test('searchInsights degrades honestly when Memory is unreachable', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const result = await searchInsights(CFG, {}, fetchImpl);
  assert.equal(result.available, false);
  assert.ok(result.reason);
});

test('getInsight fetches by id', async () => {
  const fetchImpl = async (url) => {
    assert.equal(String(url), 'https://memory.test/api/intelligence/insights/ins-1');
    return { ok: true, status: 200, json: async () => ({ data: { id: 'ins-1', statement: 'x' } }) };
  };
  const result = await getInsight(CFG, 'ins-1', fetchImpl);
  assert.equal(result.available, true);
  assert.equal(result.item.id, 'ins-1');
});

test('recordAction and recordOutcome post to their respective intelligence-loop endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return { ok: true, status: 201, json: async () => ({ data: {} }) }; };
  await recordAction(CFG, { loop_id: 'loop-1' }, fetchImpl);
  await recordOutcome(CFG, { loop_id: 'loop-1' }, fetchImpl);
  assert.equal(calls[0], 'https://memory.test/api/intelligence/actions');
  assert.equal(calls[1], 'https://memory.test/api/intelligence/outcomes');
});

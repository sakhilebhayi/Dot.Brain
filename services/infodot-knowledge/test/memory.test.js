import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../src/hmac.js';
import { readOutcomes, writeDecision } from '../src/memory.js';
import { CFG, SECRET, TOKEN, noSleep, reply } from './_fixtures.js';

const opts = { sleep: noSleep, delaysMs: [] };

test('writeDecision POSTs the record to the decisions endpoint with the bearer token only', async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return reply(201); };
  const record = { event_id: 'kc:x', subject_id: 'ctr_1' };
  const r = await writeDecision(CFG, record, { ...opts, fetchImpl });

  assert.deepEqual(r, { ok: true });
  assert.equal(seen.url, 'https://memory.test/api/intelligence/decisions');
  assert.equal(seen.options.method, 'POST');
  assert.equal(seen.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(seen.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.options.body), record);
  assert.equal(seen.options.headers['X-InfoDot-Signature'], undefined);
});

test('writeDecision reports failure without ever including the token', async () => {
  for (const fetchImpl of [async () => reply(422, { code: 'invalid' }), async () => reply(500), async () => { throw new Error(`boom ${TOKEN}`); }]) {
    const r = await writeDecision(CFG, {}, { ...opts, fetchImpl });
    assert.equal(r.ok, false);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  }
});

test('readOutcomes sends an HMAC-signed GET with the same secret and scheme', async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return reply(200, { items: [] }); };
  const r = await readOutcomes(CFG, { since: '2026-01-01T00:00:00Z', now: () => new Date(1700000000_000), ...opts, fetchImpl });

  assert.equal(r.ok, true);
  const u = new URL(seen.url);
  assert.equal(u.origin + u.pathname, 'https://memory.test/api/knowledge-recommendations/outcomes');
  assert.equal(u.searchParams.get('since'), '2026-01-01T00:00:00Z');
  assert.equal(seen.options.method, 'GET');
  const h = seen.options.headers;
  assert.equal(verify(SECRET, { timestamp: h['X-InfoDot-Timestamp'], signature: h['X-InfoDot-Signature'], now: 1700000000_000 }), true);
  assert.equal(h.Authorization, undefined);
});

test('readOutcomes keeps valid rows, counts the rest as ignored, and drops extra fields', async () => {
  const rows = [
    { contribution_ref: 'a', decision_event_id: 'kc:1', outcome: 'adopted', decided_at: '2026-01-02T00:00:00Z', moderator: 'someone' },
    { contribution_ref: 'b', decision_event_id: 'kc:2', outcome: 'declined' },
    { contribution_ref: 'c', decision_event_id: 'kc:3', outcome: 'maybe' },
    { contribution_ref: 'd', outcome: 'adopted' },
    null,
  ];
  const r = await readOutcomes(CFG, { since: 'x', ...opts, fetchImpl: async () => reply(200, { items: rows }) });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 2);
  assert.equal(r.ignored, 3);
  assert.equal(r.items[1].decided_at, null);
  assert.ok(!JSON.stringify(r.items).includes('someone'));
});

test('readOutcomes fails on 401, a malformed document, or an unreachable Memory', async () => {
  for (const fetchImpl of [async () => reply(401), async () => reply(200, {}), async () => reply(200, { items: 'x' }), async () => { throw new Error('down'); }]) {
    const r = await readOutcomes(CFG, { since: 'x', ...opts, fetchImpl });
    assert.equal(r.ok, false);
    assert.equal(r.stage, 'outcomes');
  }
});

test('outcomes are history: the latest row per decision wins (declined then adopted = adopted)', async () => {
  const rows = [
    { contribution_ref: 'a', decision_event_id: 'kc:1', outcome: 'declined', decided_at: '2026-01-01T00:00:00Z' },
    { contribution_ref: 'b', decision_event_id: 'kc:2', outcome: 'adopted', decided_at: '2026-01-02T00:00:00Z' },
    { contribution_ref: 'a', decision_event_id: 'kc:1', outcome: 'adopted', decided_at: '2026-02-01T00:00:00Z' },
    { contribution_ref: 'b', decision_event_id: 'kc:2', outcome: 'declined', decided_at: '2026-01-01T00:00:00Z' },
  ];
  const r = await readOutcomes(CFG, { since: 'x', ...opts, fetchImpl: async () => reply(200, { items: rows }) });
  const by = Object.fromEntries(r.items.map((i) => [i.decision_event_id, i.outcome]));
  assert.deepEqual(by, { 'kc:1': 'adopted', 'kc:2': 'adopted' });
  assert.equal(r.items.length, 2);
});

test('outcomes are paged: a full page continues from the last decided_at (inclusive), a short page ends', async () => {
  const row = (n, at) => ({ contribution_ref: `c${n}`, decision_event_id: `kc:${n}`, outcome: 'adopted', decided_at: at });
  const sinces = [];
  const pages = [
    [row(1, '2026-01-01T00:00:00Z'), row(2, '2026-01-02T00:00:00Z')],
    [row(2, '2026-01-02T00:00:00Z'), row(3, '2026-01-03T00:00:00Z')],
    [row(3, '2026-01-03T00:00:00Z')],
  ];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    sinces.push([u.searchParams.get('since'), u.searchParams.get('limit')]);
    return reply(200, { items: pages[sinces.length - 1] });
  };
  const r = await readOutcomes(CFG, { since: '1970-01-01T00:00:00Z', limit: 2, ...opts, fetchImpl });
  assert.deepEqual(sinces, [['1970-01-01T00:00:00Z', '2'], ['2026-01-02T00:00:00Z', '2'], ['2026-01-03T00:00:00Z', '2']]);
  assert.deepEqual(r.items.map((i) => i.decision_event_id).sort(), ['kc:1', 'kc:2', 'kc:3']);
});

test('a full page that makes no progress cannot loop the reader', async () => {
  let calls = 0;
  const same = [{ contribution_ref: 'a', decision_event_id: 'kc:1', outcome: 'adopted', decided_at: 'S' }, { contribution_ref: 'b', decision_event_id: 'kc:2', outcome: 'adopted', decided_at: 'S' }];
  const r = await readOutcomes(CFG, { since: 'S', limit: 2, ...opts, fetchImpl: async () => { calls += 1; return reply(200, { items: same }); } });
  assert.equal(calls, 1);
  assert.equal(r.items.length, 2);
});

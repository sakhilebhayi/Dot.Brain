import test from 'node:test';
import assert from 'node:assert/strict';
import { verify } from '../src/hmac.js';
import { EPOCH, pullCandidates } from '../src/infodot.js';
import { requestJson } from '../src/http.js';
import { SECRET, item, noSleep, reply } from './_fixtures.js';

const base = { baseUrl: 'https://infodot.test', secret: SECRET, sleep: noSleep, now: () => new Date(1700000000_000) };

test('requests the candidates endpoint with since/limit and a valid HMAC signature over the empty body', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push({ url, options });
    return reply(200, { items: [item()], next_since: null });
  };
  const r = await pullCandidates({ ...base, fetchImpl, since: '2026-01-01T00:00:00Z', limit: 50 });

  assert.equal(r.ok, true);
  const u = new URL(seen[0].url);
  assert.equal(u.origin + u.pathname, 'https://infodot.test/api/knowledge/candidates');
  assert.equal(u.searchParams.get('since'), '2026-01-01T00:00:00Z');
  assert.equal(u.searchParams.get('limit'), '50');
  assert.equal(seen[0].options.method, 'GET');
  assert.equal(seen[0].options.body, undefined);
  const h = seen[0].options.headers;
  assert.equal(h['X-InfoDot-Timestamp'], '1700000000');
  assert.equal(verify(SECRET, { timestamp: h['X-InfoDot-Timestamp'], signature: h['X-InfoDot-Signature'], body: '', now: 1700000000_000 }), true);
  assert.ok(!JSON.stringify(h).includes(SECRET), 'the secret itself is never sent');
  assert.ok(seen[0].options.signal, 'a timeout signal is set');
});

test('defaults to the epoch and a page size of 100', async () => {
  let url;
  await pullCandidates({ ...base, fetchImpl: async (u) => { url = new URL(u); return reply(200, { items: [], next_since: null }); } });
  assert.equal(url.searchParams.get('since'), EPOCH);
  assert.equal(url.searchParams.get('limit'), '100');
});

test('follows next_since across pages until it is null, deduplicating by reference', async () => {
  const sinces = [];
  const pages = [
    { items: [item({ contribution_ref: 'a' }), item({ contribution_ref: 'b' })], next_since: '2026-02-01T00:00:00Z' },
    { items: [item({ contribution_ref: 'b', helpful_count: 4 }), item({ contribution_ref: 'c' })], next_since: '2026-03-01T00:00:00Z' },
    { items: [], next_since: null },
  ];
  const fetchImpl = async (u) => {
    sinces.push(new URL(u).searchParams.get('since'));
    return reply(200, pages[sinces.length - 1]);
  };
  const r = await pullCandidates({ ...base, fetchImpl });
  assert.deepEqual(sinces, [EPOCH, '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z']);
  assert.equal(r.pages, 3);
  assert.deepEqual(r.items.map((i) => i.contribution_ref), ['a', 'b', 'c']);
  assert.equal(r.items[1].helpful_count, 4, 'the later copy wins');
  assert.equal(r.truncated, false);
});

test('a server that never advances next_since cannot loop the client', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(200, { items: [item()], next_since: EPOCH }); };
  const r = await pullCandidates({ ...base, fetchImpl });
  assert.equal(calls, 1);
  assert.equal(r.truncated, true);
});

test('maxPages bounds the pull and reports truncation', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(200, { items: [item({ contribution_ref: `r${calls}` })], next_since: `2026-01-${String(calls + 1).padStart(2, '0')}T00:00:00Z` }); };
  const r = await pullCandidates({ ...base, fetchImpl, maxPages: 3 });
  assert.equal(calls, 3);
  assert.equal(r.truncated, true);
  assert.equal(r.items.length, 3);
});

test('keeps only the fields scoring needs: bodies, emails and authors never get past the client', async () => {
  const leaky = { ...item(), body: 'the full answer text', email: 'a@b.co', title: 'T' };
  const r = await pullCandidates({ ...base, fetchImpl: async () => reply(200, { items: [leaky], next_since: null }) });
  const json = JSON.stringify(r.items);
  for (const needle of ['full answer text', 'a@b.co', 'author_uuid', 'url']) assert.ok(!json.includes(needle), needle);
  assert.equal(r.items[0].contribution_ref, 'ctr_abc123');
});

test('malformed items are skipped and counted; a malformed document fails the pull', async () => {
  const mixed = { items: [item(), null, 'x', { kind: 'answer' }, { contribution_ref: '' }, { contribution_ref: 'x'.repeat(201) }], next_since: null };
  const r = await pullCandidates({ ...base, fetchImpl: async () => reply(200, mixed) });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.malformed, 5);

  for (const doc of [null, {}, { items: 'no', next_since: null }, { items: [] }, { items: [], next_since: 5 }]) {
    const bad = await pullCandidates({ ...base, fetchImpl: async () => reply(200, doc) });
    assert.equal(bad.ok, false, JSON.stringify(doc));
    assert.equal(bad.kind, 'contract');
  }
});

test('a body that is not JSON is a contract failure and is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }; };
  const r = await pullCandidates({ ...base, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'contract');
  assert.equal(calls, 1);
});

test('401 fails at once with the server code and no retry', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return reply(401, { code: 'bad_signature', message: 'secret details we do not want logged' }); };
  const r = await pullCandidates({ ...base, fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(calls, 1);
  assert.match(r.reason, /HTTP 401 \(bad_signature\)/);
  assert.ok(!r.reason.includes('secret details'));
});

test('5xx, 429 and 403 are retried a bounded number of times then given up on', async () => {
  for (const status of [500, 503, 429, 403, 408]) {
    let calls = 0;
    const sleeps = [];
    const fetchImpl = async () => { calls += 1; return reply(status); };
    const r = await pullCandidates({ ...base, fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, delaysMs: [1, 2] });
    assert.equal(r.ok, false, String(status));
    assert.equal(calls, 3, `status ${status}`);
    assert.deepEqual(sleeps, [1, 2]);
  }
});

test('a transient failure that recovers on retry succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return calls === 1 ? reply(502) : reply(200, { items: [item()], next_since: null }); };
  const r = await pullCandidates({ ...base, fetchImpl, delaysMs: [1] });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
});

test('each retry is signed afresh', async () => {
  const stamps = [];
  let t = 1700000000_000;
  let calls = 0;
  const fetchImpl = async (u, o) => { stamps.push(o.headers['X-InfoDot-Timestamp']); calls += 1; return calls < 2 ? reply(500) : reply(200, { items: [], next_since: null }); };
  await pullCandidates({ ...base, fetchImpl, delaysMs: [1], now: () => new Date((t += 5000)) });
  assert.equal(stamps.length, 2);
  assert.notEqual(stamps[0], stamps[1]);
});

test('timeouts: a hanging request is aborted and reported, not waited on forever', async () => {
  const fetchImpl = (u, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason));
  });
  const started = Date.now();
  // AbortSignal.timeout's timer is unref'd (a real socket would keep the loop alive); hold it open here.
  const keepAlive = setInterval(() => {}, 1000);
  let r;
  try {
    r = await pullCandidates({ ...base, fetchImpl, timeoutMs: 20, delaysMs: [] });
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'network');
  assert.ok(Date.now() - started < 2000);
});

test('a network error never leaks the secret even if the transport put it in the message', async () => {
  const fetchImpl = async () => { throw new Error(`socket hang up while sending ${SECRET}`); };
  const r = await pullCandidates({ ...base, fetchImpl, delaysMs: [] });
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes(SECRET));
  assert.match(r.reason, /redacted/);
});

test('requestJson treats a null response as a network failure', async () => {
  const r = await requestJson({ url: 'https://x.test', headers: () => ({}), fetchImpl: async () => null, delaysMs: [], sleep: noSleep });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'network');
});

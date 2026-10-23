import test from 'node:test';
import assert from 'node:assert/strict';
import { runKnowledge, formatSummary } from '../src/run.js';
import { buildDecisionRecord } from '../src/decision.js';
import { scoreCandidate } from '../src/rules.js';
import { CFG, NOW, SECRET, TOKEN, daysAgo, item, noSleep, reply } from './_fixtures.js';

/** A fake InfoDot + Dot.Memory. Records every call. */
function world({ candidates = [], outcomes = [], memoryWrite = 201, outcomesStatus = 200, candidatesStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url);
    calls.push({ host: u.host, path: u.pathname, method: options.method ?? 'GET', body: options.body, headers: options.headers });
    if (u.host === 'infodot.test') {
      return candidatesStatus === 200 ? reply(200, { items: candidates, next_since: null }) : reply(candidatesStatus, { code: 'nope' });
    }
    if (u.pathname === '/api/knowledge-recommendations/outcomes') {
      return outcomesStatus === 200 ? reply(200, { items: outcomes }) : reply(outcomesStatus);
    }
    if (u.pathname === '/api/intelligence/decisions') return reply(memoryWrite);
    return reply(404);
  };
  const writes = () => calls.filter((c) => c.method === 'POST');
  return { fetchImpl, calls, writes };
}

const run = (w, extra = {}) => runKnowledge({ cfg: CFG, now: () => NOW, fetchImpl: w.fetchImpl, sleep: noSleep, delaysMs: [], ...extra });

const mixed = () => [
  item({ contribution_ref: 'good' }),
  item({ contribution_ref: 'soon', accepted_at: daysAgo(2) }),
  item({ contribution_ref: 'hidden', hidden: true }),
];

test('dry run (the default) pulls and reads but writes nothing, and reports counts', async () => {
  const w = world({ candidates: mixed() });
  const r = await run(w);
  assert.equal(r.ok, true);
  assert.equal(w.writes().length, 0);
  assert.equal(r.summary.mode, 'dry-run');
  assert.equal(r.summary.pulled, 3);
  assert.deepEqual(r.summary.verdicts, { recommend_for_library: 1, watch: 1, do_not_recommend: 1 });
  assert.equal(r.summary.decisions_planned, 3);
  assert.equal(r.summary.written, 0);
});

test('apply writes one decision per candidate with the bearer token', async () => {
  const w = world({ candidates: mixed() });
  const r = await run(w, { apply: true });
  assert.equal(r.summary.written, 3);
  assert.equal(r.summary.write_failed, 0);
  assert.equal(w.writes().length, 3);
  for (const call of w.writes()) {
    assert.equal(call.host, 'memory.test');
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    const body = JSON.parse(call.body);
    assert.equal(body.subject_type, 'infodot-contribution');
    assert.deepEqual(body.evidence_refs, [body.subject_id]);
  }
});

test('re-running with unchanged input produces identical event_ids (so Memory sees no new record)', async () => {
  const a = world({ candidates: mixed() });
  const b = world({ candidates: mixed() });
  await run(a, { apply: true });
  await run(b, { apply: true });
  const ids = (w) => w.writes().map((c) => JSON.parse(c.body).event_id);
  assert.deepEqual(ids(a), ids(b));
  assert.equal(new Set(ids(a)).size, 3);
});

test('a changed input produces a new event_id for that contribution only', async () => {
  const a = world({ candidates: mixed() });
  const changed = mixed();
  changed[0] = item({ contribution_ref: 'good', edited_at: daysAgo(40) });
  const b = world({ candidates: changed });
  await run(a, { apply: true });
  await run(b, { apply: true });
  const ids = (w) => w.writes().map((c) => JSON.parse(c.body).event_id);
  const [x, y] = [ids(a), ids(b)];
  assert.notEqual(x[0], y[0]);
  assert.equal(x[1], y[1]);
  assert.equal(x[2], y[2]);
});

test('a declined contribution is not recommended again while unchanged', async () => {
  const good = item({ contribution_ref: 'good' });
  const prior = buildDecisionRecord(good, scoreCandidate(good, NOW), NOW);
  const outcomes = [{ contribution_ref: 'good', decision_event_id: prior.event_id, outcome: 'declined', decided_at: daysAgo(3) }];

  const w = world({ candidates: [good], outcomes });
  const r = await run(w, { apply: true });
  assert.equal(r.summary.suppressed_declined, 1);
  assert.equal(r.summary.verdicts.recommend_for_library, 1, 'it is still scored');
  assert.equal(w.writes().length, 0);
});

test('a declined contribution is still not recommended after only a popularity change', async () => {
  const before = item({ contribution_ref: 'good', helpful_count: 1 });
  const prior = buildDecisionRecord(before, scoreCandidate(before, NOW), NOW);
  const outcomes = [{ contribution_ref: 'good', decision_event_id: prior.event_id, outcome: 'declined', decided_at: daysAgo(3) }];
  const w = world({ candidates: [item({ contribution_ref: 'good', helpful_count: 40, reuse_count: 9 })], outcomes });
  const r = await run(w, { apply: true });
  assert.equal(r.summary.suppressed_declined, 1);
  assert.equal(w.writes().length, 0);
});

test('a declined contribution IS recommended again once its inputs materially changed', async () => {
  const before = item({ contribution_ref: 'good' });
  const prior = buildDecisionRecord(before, scoreCandidate(before, NOW), NOW);
  const outcomes = [{ contribution_ref: 'good', decision_event_id: prior.event_id, outcome: 'declined', decided_at: daysAgo(3) }];

  for (const change of [{ edited_at: daysAgo(20) }, { verified_by_independent: true, verified_at: daysAgo(30) }, { topics: ['haul-roads', 'drainage'] }]) {
    const w = world({ candidates: [item({ contribution_ref: 'good', ...change })], outcomes });
    const r = await run(w, { apply: true });
    assert.equal(r.summary.suppressed_declined, 0, JSON.stringify(change));
    assert.equal(w.writes().length, 1);
  }
});

test('an adopted outcome does not suppress anything; declines only suppress recommendations', async () => {
  const good = item({ contribution_ref: 'good' });
  const prior = buildDecisionRecord(good, scoreCandidate(good, NOW), NOW);
  const w = world({ candidates: [good], outcomes: [{ contribution_ref: 'good', decision_event_id: prior.event_id, outcome: 'adopted', decided_at: daysAgo(1) }] });
  assert.equal((await run(w, { apply: true })).summary.suppressed_declined, 0);

  const hidden = item({ contribution_ref: 'gone', hidden: true });
  const w2 = world({ candidates: [hidden], outcomes: [{ contribution_ref: 'gone', decision_event_id: 'kc:zzzz:infodot-knowledge/1.0.0:d', outcome: 'declined', decided_at: daysAgo(1) }] });
  const r2 = await run(w2, { apply: true });
  assert.equal(r2.summary.suppressed_declined, 0);
  assert.equal(w2.writes().length, 1, 'a do_not_recommend decision is still recorded');
});

test('failing to read InfoDot or outcomes stops the run before any write', async () => {
  for (const opts of [{ candidatesStatus: 401 }, { outcomesStatus: 500 }]) {
    const w = world({ candidates: mixed(), ...opts });
    const r = await run(w, { apply: true });
    assert.equal(r.ok, false);
    assert.equal(w.writes().length, 0);
  }
});

test('write failures are counted, do not stop the other writes, and are reflected in the summary', async () => {
  const w = world({ candidates: mixed(), memoryWrite: 500 });
  const r = await run(w, { apply: true });
  assert.equal(r.ok, true);
  assert.equal(r.summary.written, 0);
  assert.equal(r.summary.write_failed, 3);
  assert.equal(w.writes().length, 3);
});

test('grading uses outcomes already in Memory; small samples report insufficient data', async () => {
  const outcomes = Array.from({ length: 4 }, (_, i) => ({ contribution_ref: `p${i}`, decision_event_id: `kc:m${i}:infodot-knowledge/1.0.0:d`, outcome: i < 3 ? 'adopted' : 'declined', decided_at: daysAgo(5) }));
  const w = world({ candidates: [], outcomes });
  const r = await run(w);
  const g = r.summary.grading.by_rule_version['infodot-knowledge/1.0.0'];
  assert.equal(g.status, 'insufficient data');
  assert.equal(g.hit_rate, null);
  assert.match(formatSummary(r.summary), /insufficient data \(n=4, need 10\)/);

  const many = Array.from({ length: 12 }, (_, i) => ({ contribution_ref: `p${i}`, decision_event_id: `kc:m${i}:infodot-knowledge/1.0.0:d`, outcome: i < 9 ? 'adopted' : 'declined', decided_at: daysAgo(5) }));
  const r2 = await run(world({ outcomes: many }));
  assert.match(formatSummary(r2.summary), /hit-rate 75\.0% \(adopted 9, declined 3, n=12\)/);
});

test('the summary is counts only: no refs, topics, urls or authors', async () => {
  const w = world({ candidates: mixed() });
  const r = await run(w, { apply: true });
  const text = formatSummary(r.summary) + JSON.stringify(r.summary);
  for (const needle of ['good', 'soon', 'hidden', 'haul-roads', 'infodot.co.za', '7d0c9f6e', SECRET, TOKEN, 'ctr_']) {
    assert.ok(!text.includes(needle), needle);
  }
});

test('truncation and malformed items are surfaced in the summary', async () => {
  const w = world({ candidates: [item(), { nonsense: true }] });
  const r = await run(w);
  assert.equal(r.summary.malformed_items, 1);
  assert.match(formatSummary(r.summary), /malformed 1/);
});

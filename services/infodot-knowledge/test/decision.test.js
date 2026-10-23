import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecisionRecord, eventId, inputsHash, materialInputs, parseEventId } from '../src/decision.js';
import { RULE_VERSION, scoreCandidate } from '../src/rules.js';
import { NOW, daysAgo, item } from './_fixtures.js';

const idOf = (overrides, now = NOW) => {
  const it = item(overrides);
  return eventId(it, scoreCandidate(it, now));
};

test('determinism: the same input gives the same event_id; it is stable across processes', () => {
  assert.equal(idOf({}), idOf({}));
  assert.match(idOf({}), /^kc:[0-9a-f]{16}:infodot-knowledge\/1\.0\.0:[0-9a-f]{24}$/);
});

test('changed input gives a new event_id (edit, corroboration, topics, hidden)', () => {
  const base = idOf({});
  for (const overrides of [
    { edited_at: daysAgo(30) },
    { verified_by_independent: true, verified_at: daysAgo(30) },
    { topics: ['haul-roads', 'safety'] },
    { accepted_at: '2026-08-11T08:00:00Z' },
    { contribution_ref: 'ctr_other' },
    { hidden: true },
  ]) {
    assert.notEqual(idOf(overrides), base, JSON.stringify(overrides));
  }
});

test('topic order and duplicates do not change the id', () => {
  assert.equal(idOf({ topics: ['b', 'a'] }), idOf({ topics: ['a', 'b', 'a'] }));
});

test('fields scoring never reads do not change the id: url, author_uuid, extra fields', () => {
  assert.equal(idOf({ url: 'https://x/y', author_uuid: 'other', extra: 1 }), idOf({}));
});

test('popularity changes the id only while it still moves confidence (no churn once saturated)', () => {
  assert.notEqual(idOf({ helpful_count: 1 }), idOf({ helpful_count: 0 }));
  assert.equal(idOf({ helpful_count: 50 }), idOf({ helpful_count: 5000 }));
  assert.equal(idOf({ reuse_count: 40 }), idOf({ reuse_count: 41 }));
});

test('a verdict that changes with the clock is a new decision; an unchanged one is not', () => {
  const it = item({ accepted_at: daysAgo(10) });
  const early = eventId(it, scoreCandidate(it, NOW));
  const sameDay = eventId(it, scoreCandidate(it, new Date(NOW.getTime() + 60_000)));
  const later = eventId(it, scoreCandidate(it, new Date(NOW.getTime() + 5 * 86_400_000)));
  assert.equal(scoreCandidate(it, NOW).verdict, 'watch');
  assert.equal(early, sameDay);
  assert.notEqual(early, later);
  assert.equal(parseEventId(early).material, parseEventId(later).material);
});

test('material is unchanged by popularity or the rule version, changed by the contribution', () => {
  const m = (o) => parseEventId(idOf(o)).material;
  assert.equal(m({}), m({ helpful_count: 9, reuse_count: 9 }));
  assert.notEqual(m({}), m({ edited_at: daysAgo(30) }));
  assert.equal(parseEventId(idOf({})).rule_version, RULE_VERSION);
  assert.equal(parseEventId('nonsense'), null);
  assert.equal(parseEventId(undefined), null);
});

test('inputsHash tracks the config it saturates against', () => {
  assert.notEqual(inputsHash(item({ helpful_count: 3 })), inputsHash(item({ helpful_count: 0 })));
  assert.equal(inputsHash(item({ helpful_count: 3 })), inputsHash(item({ helpful_count: 3 })));
});

test('the decision record follows the intelligence-loop envelope and carries only the opaque ref', () => {
  const it = item({ verified_by_independent: true, verified_at: daysAgo(30) });
  const result = scoreCandidate(it, NOW);
  const rec = buildDecisionRecord(it, result, NOW);

  assert.equal(rec.subject_type, 'infodot-contribution');
  assert.equal(rec.subject_id, it.contribution_ref);
  assert.equal(rec.signature, 'knowledge-candidate');
  assert.equal(rec.platform, 'dot-brain');
  assert.equal(rec.verdict, 'recommend_for_library');
  assert.deepEqual(rec.evidence_refs, [it.contribution_ref]);
  assert.equal(rec.event_id, eventId(it, result));
  assert.equal(rec.occurred_at, NOW.toISOString());
  assert.equal(rec.confidence, result.confidence);
  assert.equal(rec.autonomy_level, 'recommend');
  assert.equal(rec.requires_approval, true);
  assert.ok(rec.risk >= 0 && rec.risk <= 1);
  assert.ok(Array.isArray(rec.detail.rationale) && rec.detail.rationale.every((l) => typeof l === 'string'));
  assert.equal(rec.detail.rule_version, RULE_VERSION);
  assert.match(rec.loop_id, /^knowledge-[0-9a-f]{16}$/);
});

test('the decision record never contains content, url, author or email', () => {
  const it = item({ email: 'someone@example.com', body: 'secret body text', title: 'T' });
  const json = JSON.stringify(buildDecisionRecord(it, scoreCandidate(it, NOW), NOW));
  for (const needle of [it.author_uuid, it.url, 'someone@example.com', 'secret body text', 'author_uuid']) {
    assert.ok(!json.includes(needle), needle);
  }
});

test('watch and do_not_recommend never climb above observe', () => {
  const watched = item({ accepted_at: daysAgo(1) });
  const excluded = item({ hidden: true });
  assert.equal(buildDecisionRecord(watched, scoreCandidate(watched, NOW), NOW).autonomy_level, 'observe');
  assert.equal(buildDecisionRecord(excluded, scoreCandidate(excluded, NOW), NOW).autonomy_level, 'observe');
  assert.equal(buildDecisionRecord(excluded, scoreCandidate(excluded, NOW), NOW).verdict, 'do_not_recommend');
});

test('materialInputs leaves out counts and people', () => {
  const keys = Object.keys(materialInputs(item()));
  for (const forbidden of ['helpful_count', 'reuse_count', 'author_uuid', 'url']) {
    assert.ok(!keys.includes(forbidden), forbidden);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, MAX_POPULARITY_BONUS, RULE_VERSION, rationaleLines, resolveConfig, scoreCandidate } from '../src/rules.js';
import { DAY, NOW, daysAgo, item } from './_fixtures.js';

const score = (overrides, config) => scoreCandidate(item(overrides), NOW, config);
const rule = (result, name) => result.rationale.find((r) => r.rule === name);

test('a settled, independently accepted, public, topical contribution is recommended', () => {
  const r = score();
  assert.equal(r.verdict, 'recommend_for_library');
  assert.equal(r.rule_version, RULE_VERSION);
  assert.equal(r.confidence, 0.58); // 0.4 + 0.15 accepted + 0.03 settled >= 2x
  assert.equal(rule(r, 'corroboration').effect, 'pass');
});

test('every rationale entry is {rule, effect, detail} and reputation is stated as ignored', () => {
  const r = score();
  for (const entry of r.rationale) {
    assert.deepEqual(Object.keys(entry).sort(), ['detail', 'effect', 'rule']);
    assert.ok(entry.detail.length > 0);
  }
  assert.equal(rule(r, 'reputation').effect, 'ignored');
  assert.ok(rationaleLines(r.rationale).every((line) => typeof line === 'string' && line.includes(': ')));
});

// (b) independence
test('verified by an independent moderator alone is enough; both earn more than either', () => {
  const accepted = score();
  const verified = score({ accepted_by_independent: false, accepted_at: null, verified_by_independent: true, verified_at: '2026-08-10T08:00:00Z' });
  const both = score({ verified_by_independent: true, verified_at: '2026-08-10T08:00:00Z' });
  assert.equal(verified.verdict, 'recommend_for_library');
  assert.equal(both.verdict, 'recommend_for_library');
  assert.ok(verified.confidence > accepted.confidence);
  assert.ok(both.confidence > verified.confidence);
  assert.equal(both.confidence, 0.83);
});

test('nothing independent means do_not_recommend, even if an acceptance timestamp exists', () => {
  const r = score({ accepted_by_independent: false, verified_by_independent: false, accepted_at: '2026-08-10T08:00:00Z' });
  assert.equal(r.verdict, 'do_not_recommend');
  assert.equal(rule(r, 'corroboration').effect, 'block');
  assert.ok(r.confidence <= 0.2);
});

test('only a literal true counts as independent', () => {
  for (const flag of ['true', 1, 'yes', null, undefined]) {
    const r = score({ accepted_by_independent: flag, verified_by_independent: flag });
    assert.equal(r.verdict, 'do_not_recommend', `flag ${String(flag)}`);
  }
});

// (a) public
test('hidden and reversed contributions are never recommended and carry no confidence', () => {
  for (const overrides of [{ hidden: true }, { reversed: true }, { hidden: true, reversed: true }]) {
    const r = score(overrides);
    assert.equal(r.verdict, 'do_not_recommend');
    assert.equal(r.confidence, 0);
    assert.equal(rule(r, 'public').effect, 'block');
  }
});

test('hidden/reversed that are missing or not booleans fail closed', () => {
  for (const overrides of [{ hidden: undefined }, { reversed: undefined }, { hidden: null }, { reversed: 'no' }, { hidden: 0 }]) {
    assert.equal(score(overrides).verdict, 'do_not_recommend', JSON.stringify(overrides));
  }
});

// (c) topics
test('a contribution with no usable topic is not recommended', () => {
  for (const topics of [[], undefined, null, ['', '  '], 'haul-roads', [7]]) {
    const r = score({ topics });
    assert.equal(r.verdict, 'do_not_recommend', JSON.stringify(topics));
    assert.equal(rule(r, 'topics').effect, 'block');
  }
  assert.equal(score({ topics: ['a', ''] }).verdict, 'recommend_for_library');
});

// (d) settled
test('settling boundary: exactly 14 days after corroboration is settled, 1 ms less is not', () => {
  const at = (ms) => new Date(NOW.getTime() - ms).toISOString();
  const exactly = score({ accepted_at: at(14 * DAY), created_at: daysAgo(20) });
  const justShort = score({ accepted_at: at(14 * DAY - 1), created_at: daysAgo(20) });
  assert.equal(exactly.verdict, 'recommend_for_library');
  assert.equal(justShort.verdict, 'watch');
  assert.equal(rule(justShort, 'settled').effect, 'hold');
});

test('edit stability boundary: an edit exactly 14 days ago is settled, 1 ms less is not', () => {
  const at = (ms) => new Date(NOW.getTime() - ms).toISOString();
  assert.equal(score({ edited_at: at(14 * DAY) }).verdict, 'recommend_for_library');
  const r = score({ edited_at: at(14 * DAY - 1) });
  assert.equal(r.verdict, 'watch');
  assert.match(rule(r, 'settled').detail, /Edited/);
});

test('an old edit made after acceptance does not by itself block (stability is about time)', () => {
  assert.equal(score({ edited_at: daysAgo(30) }).verdict, 'recommend_for_library');
});

test('with two corroborations the earliest one starts the settling clock', () => {
  const r = score({
    accepted_at: daysAgo(2),
    verified_by_independent: true,
    verified_at: daysAgo(40),
    created_at: daysAgo(60),
  });
  assert.equal(r.verdict, 'recommend_for_library');
});

test('corroborated but undated, or dated in the future, is watched not recommended', () => {
  assert.equal(score({ accepted_at: null }).verdict, 'watch');
  assert.equal(rule(score({ accepted_at: null }), 'settled').effect, 'hold');
  assert.equal(score({ accepted_at: '2026-12-01T00:00:00Z' }).verdict, 'watch');
});

test('the corroboration time of a flag that is not true is ignored', () => {
  const r = score({ accepted_by_independent: false, accepted_at: daysAgo(100), verified_by_independent: true, verified_at: daysAgo(1) });
  assert.equal(r.verdict, 'watch');
});

// (f) staleness
test('staleness boundary: 18 calendar months of silence with no reuse is watch; one ms newer is not', () => {
  const stale = '2025-04-23T12:00:00.000Z'; // exactly 18 months before NOW
  const fresh = '2025-04-23T12:00:00.001Z';
  const common = { accepted_at: '2025-04-24T12:00:00Z' };
  assert.equal(score({ ...common, created_at: stale }).verdict, 'watch');
  assert.equal(rule(score({ ...common, created_at: stale }), 'stale').effect, 'hold');
  assert.equal(score({ ...common, created_at: fresh }).verdict, 'recommend_for_library');
});

test('reuse, or a recent edit, keeps an old contribution out of the stale rule', () => {
  const old = { created_at: '2024-01-01T00:00:00Z', accepted_at: '2024-01-05T00:00:00Z' };
  assert.equal(score(old).verdict, 'watch');
  assert.equal(score({ ...old, reuse_count: 1 }).verdict, 'recommend_for_library');
  assert.equal(score({ ...old, edited_at: '2026-01-01T00:00:00Z' }).verdict, 'recommend_for_library');
});

test('stale never overrides a hard exclusion', () => {
  assert.equal(score({ created_at: '2020-01-01T00:00:00Z', hidden: true }).verdict, 'do_not_recommend');
});

// (e) popularity is not trust
test('helpful and reuse counts add a small bounded bonus and never change the verdict', () => {
  const none = score();
  const huge = score({ helpful_count: 1_000_000, reuse_count: 1_000_000 });
  assert.equal(huge.verdict, none.verdict);
  const bonus = huge.confidence - none.confidence;
  assert.ok(bonus > 0);
  assert.ok(bonus <= 2 * MAX_POPULARITY_BONUS + 1e-9, `bonus ${bonus}`);
  assert.equal(huge.confidence, 0.66); // 0.58 + 0.04 helpful max + 0.04 reuse max
});

test('popularity cannot rescue an uncorroborated contribution or move any verdict', () => {
  const r = score({ accepted_by_independent: false, helpful_count: 9999, reuse_count: 9999 });
  assert.equal(r.verdict, 'do_not_recommend');
  assert.equal(r.confidence, 0.2);
  assert.equal(rule(r, 'popularity').effect, 'ignored');

  for (const overrides of [{ accepted_at: daysAgo(1) }, { hidden: true }, { topics: [] }]) {
    const base = score(overrides);
    const popular = score({ ...overrides, helpful_count: 5000, reuse_count: 5000 });
    assert.equal(popular.verdict, base.verdict, JSON.stringify(overrides));
  }
});

test('the popularity bound holds even when a caller configures it larger', () => {
  const cfg = resolveConfig({ confidence: { helpful_max: 0.9, reuse_max: 0.9 } });
  assert.equal(cfg.confidence.helpful_max, MAX_POPULARITY_BONUS);
  assert.equal(cfg.confidence.reuse_max, MAX_POPULARITY_BONUS);
});

test('negative, fractional and non-numeric counts are harmless', () => {
  const base = score();
  for (const v of [-5, 'lots', NaN, null, undefined, 0.4]) {
    assert.equal(score({ helpful_count: v, reuse_count: v }).confidence, base.confidence, String(v));
  }
});

test('the author and every other person-level field are not read', () => {
  const a = score({ author_uuid: 'aaaa' });
  const b = score({ author_uuid: 'zzzz', url: 'https://elsewhere/x', points: 99999, author_reputation: 99999 });
  assert.deepEqual(a, b);
  assert.ok(!JSON.stringify(a).includes('aaaa'));
  assert.ok(!JSON.stringify(b).includes('zzzz'));
});

// confidence discipline
test('confidence is capped: ceiling, watch ceiling, blocked ceiling', () => {
  const maxed = score(
    { verified_by_independent: true, verified_at: daysAgo(70), helpful_count: 1e6, reuse_count: 1e6 },
    { confidence: { ceiling: 0.7 } },
  );
  assert.equal(maxed.confidence, 0.7);

  const watched = score({ verified_by_independent: true, verified_at: daysAgo(1), accepted_at: daysAgo(1), helpful_count: 1e6, reuse_count: 1e6 },
    { confidence: { watch_ceiling: 0.5 } });
  assert.equal(watched.verdict, 'watch');
  assert.equal(watched.confidence, 0.5);

  const never = score({ topics: [] });
  assert.ok(never.confidence <= 0.2);
});

test('default ceiling is below certainty', () => {
  const r = score({ verified_by_independent: true, verified_at: daysAgo(70), helpful_count: 1e6, reuse_count: 1e6 });
  assert.ok(r.confidence <= DEFAULT_CONFIG.confidence.ceiling);
  assert.ok(r.confidence < 1);
});

// determinism, config, malformed input
test('same input and clock give the identical result, and the input is not mutated', () => {
  const input = item({ helpful_count: 3 });
  const frozen = JSON.stringify(input);
  assert.deepEqual(scoreCandidate(input, NOW), scoreCandidate(input, NOW));
  assert.equal(JSON.stringify(input), frozen);
});

test('now may be a Date, an ISO string or epoch ms', () => {
  const a = scoreCandidate(item(), NOW);
  assert.deepEqual(scoreCandidate(item(), NOW.toISOString()), a);
  assert.deepEqual(scoreCandidate(item(), NOW.getTime()), a);
  assert.throws(() => scoreCandidate(item(), 'not a date'), /valid `now`/);
});

test('settle_days and stale_months are configurable', () => {
  assert.equal(score({ accepted_at: daysAgo(20) }, { settle_days: 30 }).verdict, 'watch');
  assert.equal(score({ accepted_at: daysAgo(20) }, { settle_days: 7 }).verdict, 'recommend_for_library');
  assert.equal(score({}, { stale_months: 2 }).verdict, 'watch');
  assert.equal(score({ accepted_at: daysAgo(5) }, { settle_days: 0 }).verdict, 'recommend_for_library');
});

test('nonsense configuration throws instead of being guessed at', () => {
  assert.throws(() => resolveConfig({ settle_days: -1 }), /settle_days/);
  assert.throws(() => resolveConfig({ stale_months: 0 }), /stale_months/);
  assert.throws(() => resolveConfig({ stale_months: 1.5 }), /stale_months/);
  assert.throws(() => resolveConfig({ confidence: { ceiling: 2 } }), /ceiling/);
  assert.throws(() => resolveConfig({ confidence: { base: 'x' } }), /base/);
});

test('malformed candidates are excluded, never thrown on', () => {
  for (const bad of [null, undefined, 'x', 7, {}, item({ contribution_ref: '' }), item({ kind: 'question' }),
    item({ created_at: 'yesterday' }), item({ created_at: undefined }), item({ edited_at: 'soon' })]) {
    const r = scoreCandidate(bad, NOW);
    assert.equal(r.verdict, 'do_not_recommend');
    assert.equal(rule(r, 'input').effect, 'block');
  }
});

test('both kinds are accepted', () => {
  assert.equal(score({ kind: 'answer' }).verdict, 'recommend_for_library');
  assert.equal(score({ kind: 'solution' }).verdict, 'recommend_for_library');
});

test('the default configuration is frozen', () => {
  assert.throws(() => { 'use strict'; DEFAULT_CONFIG.settle_days = 1; });
});

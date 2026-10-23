// The state machine (not_ready, build_verified, release_ready), the
// ratification requirement, determinism, input validation and the rule that a
// report contains no text the engine invented.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AI_A, BUILDER, BUNDLE, DIMS, HUMAN, PROFILE, RUBRIC, automatedFor, buildSideEvidence, copy, dim, emptyEvidence,
  expertFor, observedFor, ref,
} from './_score_helpers.js';
import { EvidenceError } from '../src/score/constants.js';
import { scoreReport } from '../src/score/engine.js';
import { findSecretLike } from '../src/score/evidence.js';
import { validateReportShape } from '../src/score/schemas.js';
import { TEMPLATES, TEMPLATE_PATTERNS, say } from '../src/score/text.js';
import { stableStringify } from '../src/json.js';

const MEASURABLE = DIMS.filter((id) => dim(id).cap_without_observed_or_customer > 0);
const RATIFIED = { rubric_sha256: BUNDLE.sha256, approver: { id: 'fixture-owner', kind: 'human' }, ratified_at: '2026-10-30T09:00:00Z' };
const ratifiedProfile = () => PROFILE({ effective_status: 'ratified' });
const run = (evidence, { profile = PROFILE(), rubricRatification = null } = {}) => {
  const r = scoreReport(evidence, RUBRIC, profile, { rubricRatification });
  assert.deepEqual(validateReportShape(r), []);
  return r;
};
const codes = (list) => list.map((x) => x.code);
const D = (r, id) => r.dimensions.find((d) => d.id === id);

/** Everything a release needs: build-side evidence, observed and customer evidence on every dimension, ratified profile and rubric. */
const releaseEvidence = () => ({ ...buildSideEvidence(), observed: observedFor(DIMS, 1) });
const release = (evidence = releaseEvidence(), opts = {}) => run(evidence, { profile: ratifiedProfile(), rubricRatification: RATIFIED, ...opts });

// ---------- build_verified ----------

// Hand-built so attainment is EXACTLY 90.00. All checks 1.0 and a human at level 4 give 37.45 + 24.75 = 62.2.
// Setting five checks to 0 removes: d1.copy_profile_language_lint 8x0.15x0.40 = 0.48; d2.impeccable_detect_findings 7x0.25x0.40 = 0.70;
// d5.test_pass_counts 10x0.70x0.30 = 2.10; d8.token_pair_contrast 12x0.50x0.25 = 1.50; d10.error_path_tests 8x0.60x0.30 = 1.44.
// 0.48 + 0.70 + 2.10 + 1.50 + 1.44 = 6.22, so evidenced = 62.2 - 6.22 = 55.98 = 0.9 x 62.2.
const ZEROED = ['d1.copy_profile_language_lint', 'd2.impeccable_detect_findings', 'd5.test_pass_counts', 'd8.token_pair_contrast', 'd10.error_path_tests'];
const atBoundary = () => {
  const e = buildSideEvidence();
  for (const a of e.automated) if (ZEROED.includes(a.check_id)) a.value = 0;
  return e;
};

test('build_verified at attainment exactly 90.00 percent', () => {
  const r = run(atBoundary());
  assert.equal(r.headline.evidenced_score, 55.98);
  assert.equal(r.headline.attainment_percent, 90);
  assert.equal(r.state, 'build_verified');
  assert.deepEqual(r.blockers, []);
});

test('not_ready just under: 0.99 on one more check puts attainment at 89.98 and the displayed number is never rounded up to 90', () => {
  // d3.nav_depth: 12 x 0.30 x 0.20 = 0.72 x 0.01 = 0.0072 lost -> 55.9728 / 62.2 = 89.988...
  const e = atBoundary();
  e.automated.find((a) => a.check_id === 'd3.nav_depth').value = 0.99;
  const r = run(e);
  assert.equal(r.headline.attainment_percent, 89.98);
  assert.equal(r.state, 'not_ready');
  assert.deepEqual(codes(r.state_reasons), ['attainment_below_minimum']);
  assert.match(r.state_reasons[0].text, /Attainment is 89\.98 percent; build_verified needs at least 90 percent/);
});

test('every dimension must meet its floor: functional completeness exactly at 0.70 passes, just under fails', () => {
  // floor 0.70 of 10 x 0.90 = 9 -> 6.3 points. Automated 2.1 + 1.75 + 1.4 + 1.75 x 0.6 = 6.3, expert level 0.
  const make = (stubs) => {
    const e = buildSideEvidence();
    for (const a of e.automated) {
      if (a.check_id === 'd5.stubs_placeholders') a.value = stubs;
    }
    e.expert = e.expert.map((x) => (x.dimension === 'functional_completeness' ? { ...x, level: 0 } : x));
    return e;
  };
  const exact = run(make(0.6));
  assert.equal(D(exact, 'functional_completeness').points_earned, 6.3);
  assert.equal(D(exact, 'functional_completeness').floor_attainment_percent, 70);
  assert.equal(D(exact, 'functional_completeness').floor_met, true);
  assert.equal(exact.state, 'build_verified');
  const under = run(make(0.59)); // 6.2825 points -> 69.80 percent
  assert.equal(D(under, 'functional_completeness').floor_met, false);
  assert.ok(under.headline.attainment_percent >= 90, 'the total is fine; only the floor fails');
  assert.equal(under.state, 'not_ready');
  assert.deepEqual(codes(under.state_reasons), ['floor_not_met']);
  assert.match(under.state_reasons[0].text, /functional_completeness reaches 69\.80 percent of its non-observed ceiling; its floor is 70\.00 percent/);
});

test('a blocker prevents build_verified even at 100 percent attainment', () => {
  const e = buildSideEvidence();
  e.findings = [{ id: 'w1', kind: 'wcag_failure', level: 'A', criterion: '1.1.1', detail: 'Fixture finding.', artifact_ref: ref('w') }];
  const r = run(e);
  assert.equal(r.state, 'not_ready');
  assert.deepEqual(codes(r.state_reasons).includes('blockers_present'), true);
});

test('the 90 percent target is not met by inflation: unmeasured work leaves the state not_ready', () => {
  const r = run(emptyEvidence({ automated: automatedFor(MEASURABLE, 1) }));
  assert.equal(r.state, 'not_ready');
  assert.ok(r.headline.attainment_percent < 90);
});

// ---------- release_ready ----------

test('release_ready: everything met, ratified profile and rubric, observed evidence on dimensions 3, 6 and 7', () => {
  const r = release();
  assert.equal(r.headline.evidenced_score, 100);
  assert.equal(r.state, 'release_ready');
  assert.deepEqual(r.release_ready_unmet, []);
  assert.equal(r.confidence.band, 'High');
  assert.equal(r.header.rubric.status, 'ratified');
  assert.equal(r.header.rubric.ratified_by, 'fixture-owner');
});

test('release_ready at evidenced exactly 90.00; at 89.84 it is not even build_verified, because with full observed coverage the ceiling is 100', () => {
  // Dimensions 11 and 12 measured at 0.0: 100 - 5 - 5 = 90 exactly. Ceiling is 100, so attainment is 90.00 too.
  const base = () => {
    const e = releaseEvidence();
    for (const o of e.observed) if (o.dimension === 'measurable_customer_outcomes' || o.dimension === 'retention_continuing_value') o.value = 0;
    return e;
  };
  const exact = release(base());
  assert.equal(exact.headline.evidenced_score, 90);
  assert.equal(exact.headline.attainment_percent, 90);
  assert.equal(exact.state, 'release_ready');
  // Dimension 7 observed share is 8 x 0.5 = 4, first_session_goal_reached has weight 40: 1.6 possible; 0.9 loses 0.16.
  const e = base();
  e.observed.find((o) => o.metric_id === 'first_session_goal_reached').value = 0.9;
  const lower = release(e);
  assert.equal(lower.headline.evidenced_score, 89.84);
  assert.equal(lower.state, 'not_ready');
  assert.ok(codes(lower.release_ready_unmet).includes('evidenced_below_release_minimum'));
  assert.match(lower.release_ready_unmet.find((x) => x.code === 'evidenced_below_release_minimum').text, /Evidenced score is 89\.84; release_ready needs at least 90/);
});

test('evidenced below 90 while build_verified: possible when observed evidence covers only some dimensions', () => {
  // Observed on dimensions 3, 6 and 7 only: ceiling is 62.2 + 4.8 + 3 + 4 = 74. Everything measured at the maximum reaches 74, attainment 100, evidenced 74.
  const e = buildSideEvidence();
  e.observed = observedFor(['usability_cognitive_load', 'trust_transparency', 'perceived_demonstrated_value'], 1);
  const r = release(e);
  assert.equal(r.headline.ceiling, 74);
  assert.equal(r.headline.evidenced_score, 74);
  assert.equal(r.state, 'build_verified');
  assert.deepEqual(codes(r.release_ready_unmet), ['evidenced_below_release_minimum']);
});

test('release_ready needs observed or customer evidence on dimensions 3, 6 and 7, each independently', () => {
  for (const id of ['usability_cognitive_load', 'trust_transparency', 'perceived_demonstrated_value']) {
    const e = releaseEvidence();
    e.observed = e.observed.filter((o) => o.dimension !== id);
    const r = release(e);
    assert.equal(r.state, 'build_verified', id);
    assert.deepEqual(codes(r.release_ready_unmet), ['observed_missing'], id);
    assert.match(r.release_ready_unmet[0].text, new RegExp(`dimension ${id}`));
    assert.ok(r.headline.evidenced_score >= 90, `${id}: the score alone would have passed`);
  }
});

test('dimension 8 needs observed evidence only where assistive-technology testing is possible', () => {
  const without = () => { const e = releaseEvidence(); e.observed = e.observed.filter((o) => o.dimension !== 'accessibility_inclusion'); return e; };
  assert.equal(release(without()).state, 'release_ready');
  const e = without();
  e.context.assistive_technology_testing_possible = true;
  const r = release(e);
  assert.equal(r.state, 'build_verified');
  assert.deepEqual(codes(r.release_ready_unmet), ['observed_missing']);
  assert.match(r.release_ready_unmet[0].text, /accessibility_inclusion/);
});

test('release_ready needs confidence of Medium or better: a disagreement caps it', () => {
  const e = releaseEvidence();
  e.expert = e.expert.map((x) => (x.dimension === 'emotional_clarity_positioning' ? { ...x, level: 2 } : x)); // automated level 4 vs 2
  const r = release(e);
  assert.equal(r.confidence.band, 'Low');
  assert.equal(r.state, 'build_verified');
  assert.deepEqual(codes(r.release_ready_unmet), ['confidence_below_medium']);
  assert.ok(r.headline.evidenced_score >= 90);
});

test('a draft, proposed or superseded profile caps the state at build_verified, and the report says why', () => {
  for (const status of ['draft', 'proposed', 'superseded']) {
    const r = release(releaseEvidence(), { profile: PROFILE({ effective_status: status }) });
    assert.equal(r.state, 'build_verified', status);
    assert.deepEqual(codes(r.release_ready_unmet), ['profile_not_ratified'], status);
    assert.match(r.release_ready_unmet[0].text, new RegExp(`The profile is ${status}, not ratified`));
    assert.ok(codes(r.state_reasons).includes('release_ready_not_reached'));
  }
});

test('a rubric that is not ratified caps the state at build_verified; a ratification for another hash, or by an AI, does not count', () => {
  const none = run(releaseEvidence(), { profile: ratifiedProfile() });
  assert.equal(none.state, 'build_verified');
  assert.deepEqual(codes(none.release_ready_unmet), ['rubric_not_ratified']);
  assert.equal(none.header.rubric.status, 'proposed');
  assert.match(none.release_ready_unmet[0].text, /rubric is proposed, not ratified/);
  for (const bad of [{ ...RATIFIED, rubric_sha256: 'f'.repeat(64) }, { ...RATIFIED, approver: { id: 'ai', kind: 'ai' } }, { ...RATIFIED, ratified_at: undefined }]) {
    const r = run(releaseEvidence(), { profile: ratifiedProfile(), rubricRatification: bad });
    assert.equal(r.state, 'build_verified');
    assert.equal(r.header.rubric.status, 'proposed');
  }
});

test('release_ready needs built_by declared whenever expert assessments are supplied, so independence can be verified', () => {
  const e = releaseEvidence();
  delete e.built_by;
  const r = release(e);
  assert.equal(r.state, 'build_verified');
  assert.deepEqual(codes(r.release_ready_unmet), ['builder_not_declared']);
  assert.ok(codes(r.confidence.reasons).includes('independence_unverified'));
});

test('release_ready also needs the build_verified floors: states are ordered', () => {
  const e = releaseEvidence();
  // Functional completeness is a 10-point dimension: measured at zero everywhere it can be, the total is 90 - but its floor fails.
  e.automated = e.automated.map((a) => (a.check_id.startsWith('d5.') ? { ...a, value: 0 } : a));
  e.expert = e.expert.map((x) => (x.dimension === 'functional_completeness' ? { ...x, level: 0 } : x));
  e.observed = e.observed.map((o) => (o.dimension === 'functional_completeness' ? { ...o, value: 0 } : o));
  const r = release(e);
  assert.equal(r.headline.evidenced_score, 90);
  assert.equal(r.state, 'not_ready');
  assert.ok(codes(r.state_reasons).includes('floor_not_met'));
});

test('a blocker prevents release_ready and build_verified', () => {
  const e = releaseEvidence();
  e.findings = [{ id: 'c1', kind: 'unsupported_claim', detail: 'Fixture finding.', artifact_ref: ref('c') }];
  const r = release(e);
  assert.equal(r.state, 'not_ready');
  assert.equal(r.blockers.length, 1);
});

test('the lone AI session cannot reach release_ready: AI-only expert credit and no ratification both hold it back', () => {
  const e = { ...buildSideEvidence({ assessors: [AI_A] }), observed: observedFor(DIMS, 1) };
  const r = run(e);
  assert.notEqual(r.state, 'release_ready');
});

// ---------- the precedence rule ----------

test('a brand rule can never raise a score a safety, security or accessibility finding lowers (ADR-0021, decision 8)', () => {
  const clean = release();
  const e = releaseEvidence();
  e.findings = [{ id: 'o1', kind: 'domain_override_violation', dimension: 'trust_transparency', principle: 'BXP-04', detail: 'Fixture: a brand rule was applied where the profile says it yields.', artifact_ref: ref('o') }];
  const r = release(e);
  assert.equal(D(r, 'trust_transparency').points_earned, 5);           // 10 x 0.5
  assert.ok(r.headline.evidenced_score <= clean.headline.evidenced_score - 5);
  // brand dimensions stay at their maximum and do not move the capped dimension
  for (const id of ['emotional_clarity_positioning', 'brand_distinctiveness', 'cross_platform_consistency']) assert.equal(D(r, id).points_earned, D(clean, id).points_earned);
  assert.equal(r.state, 'not_ready');
  assert.deepEqual(r.domain_overrides.map((d) => d.principle), ['BXP-04']);
});

// ---------- input validation ----------

const invalid = (mutate, pattern) => {
  const e = buildSideEvidence();
  mutate(e);
  assert.throws(() => scoreReport(e, RUBRIC, PROFILE()), (err) => err instanceof EvidenceError && pattern.test(err.message), String(pattern));
};

test('invalid evidence is refused with a message: schema, duplicates, unknown ids and undeclared assessors', () => {
  invalid((e) => { delete e.generated_at; }, /generated_at: is required/);
  invalid((e) => { e.automated[0].value = 1.5; }, /must be <= 1/);
  invalid((e) => { e.automated[0].artifact_ref = 'has spaces'; }, /does not match pattern/);
  invalid((e) => { e.input.commit = 'abc'; }, /does not match pattern/);
  invalid((e) => { e.automated.push({ ...e.automated[0] }); }, /more than one result for/);
  invalid((e) => { e.automated[0].check_id = 'd1.no_such_check'; }, /unknown check_id d1\.no_such_check/);
  invalid((e) => { e.expert[0].assessor = 'someone-else'; }, /assessor someone-else is not declared/);
  invalid((e) => { e.expert[0].dimension = 'made_up'; }, /unknown dimension made_up/);
  invalid((e) => { e.expert.push({ ...e.expert[0] }); }, /more than one assessment/);
  invalid((e) => { e.assessors.push({ ...e.assessors[0] }); }, /items must be unique|duplicate id/);
  invalid((e) => { e.extra = true; }, /extra: is not an allowed property/);
  invalid((e) => { e.evidence_version = '2.0.0'; }, /must be "1\.0\.0"/);
  invalid((e) => { e.expert[0].level = 5; }, /must be <= 4/);
  invalid((e) => { e.findings = [{ id: 'f', kind: 'invented_kind', detail: 'x', artifact_ref: 'a' }]; }, /must be one of/);
  assert.throws(() => scoreReport(null, RUBRIC, PROFILE()), EvidenceError);
  assert.throws(() => scoreReport(buildSideEvidence(), RUBRIC, { id: 'x' }), /profile is missing/);
});

test('evidence that contains a credential-shaped string is refused', () => {
  // Assembled at run time so no credential-shaped literal sits in the repository.
  const shapes = [`gh${'p'}_${'a'.repeat(30)}`, `github_pat_${'b'.repeat(30)}`, `AKIA${'C'.repeat(16)}`, `sk-${'d'.repeat(30)}`, `-----BEGIN ${'RSA'} PRIVATE KEY-----`, `Bearer ${'e'.repeat(30)}`, `xox${'b'}-${'1'.repeat(20)}`];
  for (const secret of shapes) {
    const e = buildSideEvidence();
    e.automated[0].detail = `Output included ${secret} by mistake`;
    assert.deepEqual(findSecretLike(e), ['$.automated[0].detail']);
    assert.throws(() => scoreReport(e, RUBRIC, PROFILE()), /looks like a credential/);
  }
  assert.deepEqual(findSecretLike(buildSideEvidence()), []);
});

// ---------- determinism, purity ----------

test('same input, byte-identical report; key order and array order of the input do not matter; the input is not changed', () => {
  const e = { ...buildSideEvidence({ assessors: [HUMAN, AI_A] }), observed: observedFor(['usability_cognitive_load'], 0.8), findings: [{ id: 'z', kind: 'failing_test', detail: 'Fixture finding.', artifact_ref: ref('f') }] };
  const frozen = JSON.stringify(e);
  const a = stableStringify(run(e));
  assert.equal(stableStringify(run(JSON.parse(frozen))), a);
  assert.equal(JSON.stringify(e), frozen, 'scoreReport does not mutate its input');
  const shuffled = JSON.parse(frozen);
  shuffled.automated.reverse();
  shuffled.expert.reverse();
  shuffled.assessors.reverse();
  shuffled.observed.reverse();
  // The only thing that may differ is the hash of the input as written (array order is part of the file); the scoring is identical.
  const strip = (r) => { const c = JSON.parse(stableStringify(r)); delete c.header.input.evidence_sha256; return stableStringify(c); };
  assert.equal(strip(run(shuffled)), strip(run(JSON.parse(frozen))));
});

test('the report takes its timestamp from the evidence and reads no clock or environment', () => {
  const e = buildSideEvidence();
  e.generated_at = '2031-01-02T03:04:05Z';
  assert.equal(run(e).header.generated_at, '2031-01-02T03:04:05Z');
  const source = readdirSync(fileURLToPath(new URL('../src/score/', import.meta.url)))
    .map((f) => readFileSync(fileURLToPath(new URL(`../src/score/${f}`, import.meta.url)), 'utf8')).join('\n');
  assert.ok(!/Date\.now|new Date\(|process\.env|Math\.random|performance\.now/.test(source.replace(/Date\.parse/g, '')), 'no clock, no environment, no randomness in the scoring code');
});

// ---------- no invented text ----------

test('every sentence the engine writes comes from a fixed template; every other string is input or an id', () => {
  const e = { ...buildSideEvidence({ assessors: [HUMAN, AI_A] }), observed: [
    ...observedFor(['usability_cognitive_load'], 0.8, 4),
    { dimension: 'retention_continuing_value', source_class: 'observed_behaviour', metric_id: 'streak_days', value: 1, n: 50, method: 'Fixture method.', artifact_ref: ref('s') },
  ], findings: [
    { id: 'w1', kind: 'wcag_failure', level: 'AA', criterion: '1.4.3', detail: 'Fixture finding.', artifact_ref: ref('w') },
    { id: 'w2', kind: 'wcag_failure', level: 'AAA', criterion: '1.4.6', detail: 'Fixture finding.', artifact_ref: ref('w2') },
    { id: 'e1', kind: 'ethics_gate_flag', detail: 'Fixture finding.', artifact_ref: ref('e') },
  ] };
  e.built_by = BUILDER.id;
  e.expert.push(...expertFor(['accessibility_inclusion'], BUILDER, 4));
  const r = run(e);
  const inputStrings = new Set();
  const collect = (v) => { if (typeof v === 'string') inputStrings.add(v); else if (v && typeof v === 'object') Object.values(v).forEach(collect); };
  collect(e); collect(RUBRIC); collect(PROFILE());
  const isTemplate = (s) => TEMPLATE_PATTERNS.some((p) => p.re.test(s));
  const seen = { text: 0, detail: 0 };
  const walk = (v, key) => {
    if (typeof v === 'string') {
      if (key === 'text') { seen.text += 1; assert.ok(isTemplate(v), `engine text must come from a template: ${v}`); }
      if (key === 'detail') { seen.detail += 1; assert.ok(inputStrings.has(v) || isTemplate(v), `detail must be input or a template: ${v}`); }
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(r);
  assert.ok(seen.text > 10 && seen.detail > 30, JSON.stringify(seen));
});

test('no template says a user feels, likes, loves or is satisfied: the engine cannot assert a feeling', () => {
  for (const [key, text] of Object.entries(TEMPLATES)) {
    assert.ok(!/\b(feel|feels|felt|feeling|love|loves|delight|delighted|enjoy|enjoys|satisf\w*|happy|trust(s|ed)? (the|it)|users? (are|is|have|has))\b/i.test(text), `${key}: ${text}`);
  }
});

test('every template is used by the code, and say() fails loudly on a missing or extra hole', () => {
  const source = readdirSync(fileURLToPath(new URL('../src/score/', import.meta.url)))
    .filter((f) => f !== 'text.js').map((f) => readFileSync(fileURLToPath(new URL(`../src/score/${f}`, import.meta.url)), 'utf8')).join('\n');
  for (const key of Object.keys(TEMPLATES)) {
    assert.ok(source.includes(`'${key}'`) || /^compare_(identical|patch|minor|major)$/.test(key), `unused template ${key}`);
  }
  assert.throws(() => say('state_blockers_present', {}), /needs count/);
  assert.throws(() => say('state_blockers_present', { count: 1, extra: 2 }), /no hole extra/);
  assert.throws(() => say('nonexistent'), /unknown message/);
});

test('the report records the rubric hash, engine, profile, input commit, timestamp and assessors', () => {
  const r = run({ ...buildSideEvidence(), generated_at: '2026-10-24T08:30:00Z' });
  assert.equal(r.header.rubric.sha256, BUNDLE.sha256);
  assert.equal(r.header.rubric.version, '1.0.0');
  assert.equal(r.header.engine_version, '0.2.0');
  assert.deepEqual([r.header.profile.id, r.header.profile.version, r.header.profile.effective_status], ['fixture-product', '0.1.0', 'draft']);
  assert.match(r.header.profile.sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.header.input.commit, 'a'.repeat(40));
  assert.match(r.header.input.evidence_sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.header.generated_at, '2026-10-24T08:30:00Z');
  assert.deepEqual(r.header.assessors, [{ id: HUMAN.id, kind: 'human' }]);
});

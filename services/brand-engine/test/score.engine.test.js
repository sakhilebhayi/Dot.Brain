// The arithmetic and the rules of scoreReport, on hand-computed fixtures.
// Every fixture here is synthetic. The calculation behind each expected
// number is written next to it so a reader can check it without the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_A, AI_B, BUILDER, BUNDLE, DIMS, HUMAN, PROFILE, RUBRIC, automatedFor, buildSideEvidence, copy, dim,
  emptyEvidence, expertFor, observedFor, ref,
} from './_score_helpers.js';
import { EvidenceError } from '../src/score/constants.js';
import { scoreReport } from '../src/score/engine.js';
import { validateReportShape } from '../src/score/schemas.js';

const MEASURABLE = DIMS.filter((id) => dim(id).cap_without_observed_or_customer > 0);
const RATIFIED_RUBRIC = { rubric_sha256: BUNDLE.sha256, approver: { id: 'fixture-owner', kind: 'human' }, ratified_at: '2026-10-30T09:00:00Z' };
const score = (evidence, { profile = PROFILE(), ratified = false } = {}) => {
  const report = scoreReport(evidence, RUBRIC, profile, ratified ? { rubricRatification: RATIFIED_RUBRIC } : {});
  assert.deepEqual(validateReportShape(report), [], 'every report validates against its schema');
  return report;
};
const D = (report, id) => report.dimensions.find((d) => d.id === id);
const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ''} expected ${expected}, got ${actual}`);
const withAssessors = (e, ...extra) => { for (const a of extra) if (!e.assessors.some((x) => x.id === a.id)) e.assessors.push(a); return e; };

// ---------- the headline arithmetic ----------

test('nothing measured: evidenced 0, ceiling 62.2 shown, attainment 0, all twelve dimensions listed as not measured', () => {
  const r = score(emptyEvidence());
  assert.deepEqual(r.headline, { evidenced_score: 0, ceiling: 62.2, attainment_percent: 0, out_of: 100 });
  assert.equal(r.dimensions.length, 12);
  assert.ok(r.dimensions.every((d) => d.status === 'not_measured' && d.points_earned === 0));
  assert.equal(r.state, 'not_ready');
  // 37 automated checks + 10 expert (one per measurable dimension) + 24 observed/customer metrics are all listed as missing.
  const metrics = DIMS.reduce((s, id) => s + dim(id).evidence.observed_behaviour.metrics.length + dim(id).evidence.customer_feedback.metrics.length, 0);
  assert.equal(r.missing_evidence.length, 37 + 10 + metrics);
});

test('automated 1.0 everywhere plus a human expert at level 4: evidenced equals the ceiling (62.2)', () => {
  // each measurable dimension earns w x (a + x) = w x cap; sum = 62.2 (see the rubric test)
  const r = score(buildSideEvidence());
  assert.deepEqual(r.headline, { evidenced_score: 62.2, ceiling: 62.2, attainment_percent: 100, out_of: 100 });
  assert.equal(D(r, 'emotional_clarity_positioning').points_earned, 4);        // 8 x 0.5
  assert.equal(D(r, 'usability_cognitive_load').points_earned, 7.2);           // 12 x 0.6
  assert.equal(D(r, 'functional_completeness').points_earned, 9);              // 10 x 0.9
  assert.equal(D(r, 'accessibility_inclusion').points_earned, 8.4);            // 12 x 0.7
  assert.equal(D(r, 'retention_continuing_value').points_earned, 0);
  assert.equal(r.state, 'build_verified');
});

test('automated only: evidenced is the automated shares (37.45), the expert shares are shown as not measured (24.75)', () => {
  // sum of w x a = 8x0.15 + 7x0.25 + 12x0.30 + 9x0.50 + 10x0.70 + 10x0.40 + 8x0.20 + 12x0.50 + 6x0.50 + 8x0.60
  //              = 1.2 + 1.75 + 3.6 + 4.5 + 7 + 4 + 1.6 + 6 + 3 + 4.8 = 37.45
  const e = emptyEvidence({ automated: automatedFor(MEASURABLE, 1) });
  const r = score(e);
  assert.equal(r.headline.evidenced_score, 37.45);
  assert.equal(r.headline.ceiling, 62.2);
  assert.equal(r.headline.attainment_percent, 60.2); // 37.45 / 62.2 = 60.209...% truncated, not rounded
  const notMeasured = r.dimensions.reduce((s, d) => s + d.points_not_measured, 0);
  near(notMeasured, 24.75, 'expert shares not measured'); // 62.2 - 37.45
  assert.ok(r.dimensions.filter((d) => d.components.expert_assessment.allowed).every((d) => d.status === 'partially_evidenced'));
});

test('AI-only expert assessments count at most 50% of the expert-eligible weight', () => {
  // automated 37.45 + 0.5 x 24.75 = 37.45 + 12.375 = 49.825 (displayed truncated: 49.82)
  const e = withAssessors(buildSideEvidence({ assessors: [AI_A] }), AI_A);
  const r = score(e);
  assert.equal(r.headline.evidenced_score, 49.82);
  assert.equal(r.headline.attainment_percent, 80.1); // 49.825 / 62.2 = 80.1045...
  const d5 = D(r, 'functional_completeness'); // w10 x share 0.2 = 2 expert points possible
  assert.equal(d5.components.expert_assessment.points_earned, 1);
  assert.equal(d5.components.expert_assessment.points_withheld_ai_only, 1);
  assert.equal(d5.components.expert_assessment.ai_only, true);
  near(r.dimensions.reduce((s, d) => s + d.components.expert_assessment.points_withheld_ai_only, 0), 12.375, 'withheld');
});

test('the AI 50% boundary: a human assessment, even beside an AI one, is counted in full; AI alone is halved', () => {
  const ai = withAssessors(buildSideEvidence({ assessors: [AI_A] }), AI_A);
  const human = withAssessors(buildSideEvidence({ assessors: [HUMAN] }), HUMAN);
  const both = withAssessors(buildSideEvidence({ assessors: [HUMAN, AI_A] }), HUMAN, AI_A);
  assert.equal(D(score(ai), 'functional_completeness').components.expert_assessment.points_earned, 1);
  assert.equal(D(score(human), 'functional_completeness').components.expert_assessment.points_earned, 2);
  const b = D(score(both), 'functional_completeness');
  assert.equal(b.components.expert_assessment.points_earned, 2);
  assert.equal(b.components.expert_assessment.ai_only, false);
  assert.ok(b.evidence.some((x) => x.assessor === AI_A.id && x.disposition === 'corroborating' && x.value === 1));
  assert.ok(b.evidence.every((x) => x.assessor !== AI_A.id || x.disposition === 'corroborating'), 'the AI assessment carries no points beside a human one');
});

test('expert levels scale linearly: level 2 is half, the mean of independent assessors is used', () => {
  const lvl2 = buildSideEvidence({ expertLevel: 2 });
  // D1 expert possible 8 x 0.35 = 2.8; level 2 of 4 = 1.4; automated 1.2 -> 2.6
  assert.equal(D(score(lvl2), 'emotional_clarity_positioning').points_earned, 2.6);
  const second = { id: 'human-two', kind: 'human' };
  const e = withAssessors(buildSideEvidence({ expertLevel: 4 }), second);
  e.expert.push(...expertFor(MEASURABLE, second, 2).map((x) => ({ ...x }))); // 4 and 2 -> mean 3 -> 0.75
  assert.equal(D(score(e), 'emotional_clarity_positioning').points_earned, 3.3); // 1.2 + 2.8 x 0.75
});

test('the rubric dimension weights are respected: a single dimension with only its expert share and nothing else', () => {
  const e = withAssessors(emptyEvidence(), HUMAN);
  e.expert = expertFor(['accessibility_inclusion'], HUMAN, 4);
  const r = score(e);
  assert.equal(r.headline.evidenced_score, 2.4); // 12 x 0.2
  assert.equal(D(r, 'accessibility_inclusion').status, 'partially_evidenced');
});

// ---------- caps and the observed / customer share ----------

test('without observed or customer evidence a dimension cannot exceed weight x cap, and the capped-away points are shown', () => {
  const r = score(buildSideEvidence());
  for (const d of RUBRIC.dimensions.filter((x) => x.cap_without_observed_or_customer > 0)) {
    const got = D(r, d.id);
    near(got.points_earned, d.weight * d.cap_without_observed_or_customer, d.id);
    assert.equal(got.cap_applied.applied, true);
    near(got.cap_applied.points_capped_away, d.weight * (1 - d.cap_without_observed_or_customer), d.id);
  }
  assert.equal(D(r, 'usability_cognitive_load').cap_applied.points_capped_away, 4.8); // 12 x 0.4
});

test('observed and customer evidence lifts the cap: every measured dimension can then reach its full weight', () => {
  const e = buildSideEvidence();
  e.observed = observedFor(DIMS, 1);
  const r = score(e, { ratified: true, profile: PROFILE({ effective_status: 'ratified' }) });
  assert.equal(r.headline.evidenced_score, 100);
  assert.equal(r.headline.ceiling, 100);
  assert.equal(D(r, 'usability_cognitive_load').cap_applied.applied, false);
  assert.equal(D(r, 'usability_cognitive_load').points_earned, 12);
  assert.equal(r.state, 'release_ready');
});

test('partial observed evidence earns only the metrics measured; the rest is not measured and counts as zero', () => {
  const e = buildSideEvidence();
  e.observed = observedFor(['usability_cognitive_load'], 1).filter((x) => x.metric_id === 'task_completion_rate'); // weight 35
  const r = score(e);
  const d3 = D(r, 'usability_cognitive_load');
  // observed share 12 x 0.4 = 4.8 possible; one metric of weight 35 at 1.0 earns 4.8 x 0.35 = 1.68; 7.2 + 1.68 = 8.88
  assert.equal(d3.components.observed_or_customer.points_earned, 1.68);
  assert.equal(d3.points_earned, 8.88);
  assert.equal(d3.ceiling_points, 12, 'any counted observed evidence lifts the ceiling to the full weight');
  assert.equal(d3.cap_applied.applied, false);
  assert.equal(d3.points_not_measured, 3.12); // 4.8 x (1 - 0.35)
  assert.equal(d3.status, 'partially_evidenced');
});

test('an observed result of 0.5 earns half of that metric', () => {
  const e = buildSideEvidence();
  e.observed = observedFor(['usability_cognitive_load'], 0.5);
  const d3 = D(score(e), 'usability_cognitive_load');
  assert.equal(d3.components.observed_or_customer.points_earned, 2.4); // 4.8 x 0.5
});

test('observed minimum n: n = 4 is rejected, n = 5 is counted', () => {
  const four = buildSideEvidence();
  four.observed = observedFor(['usability_cognitive_load'], 1, 4);
  const r4 = score(four);
  assert.equal(D(r4, 'usability_cognitive_load').components.observed_or_customer.metrics_measured, 0);
  assert.equal(r4.rejected_evidence.filter((x) => x.reason_code === 'below_minimum_n').length, 3);
  assert.match(r4.rejected_evidence[0].text, /n is 4, below the rubric minimum of 5/);
  const five = buildSideEvidence();
  five.observed = observedFor(['usability_cognitive_load'], 1, 5);
  assert.equal(D(score(five), 'usability_cognitive_load').components.observed_or_customer.metrics_measured, 3);
});

// ---------- dimensions 11 and 12 ----------

test('dimensions 11 and 12 are not measured without observed or customer evidence, however much else is supplied', () => {
  const r = score(buildSideEvidence());
  for (const id of ['retention_continuing_value', 'measurable_customer_outcomes']) {
    const d = D(r, id);
    assert.equal(d.status, 'not_measured');
    assert.equal(d.points_earned, 0);
    assert.equal(d.ceiling_points, 0);
    assert.equal(d.cap_applied.points_capped_away, 5);
    assert.ok(d.evidence.every((x) => x.disposition === 'not_measured'));
  }
});

test('expert evidence for dimension 11 is rejected, not scored; automated evidence for it is invalid input', () => {
  const e = withAssessors(emptyEvidence(), HUMAN);
  e.expert = [{ dimension: 'retention_continuing_value', assessor: HUMAN.id, level: 4, rationale: 'Fixture rationale.', artifact_ref: ref('x') }];
  const r = score(e);
  assert.equal(D(r, 'retention_continuing_value').points_earned, 0);
  assert.equal(r.rejected_evidence[0].reason_code, 'class_not_allowed');
  assert.equal(r.headline.evidenced_score, 0);

  const bad = emptyEvidence({ automated: [{ check_id: 'd11.opens', value: 1, artifact_ref: ref('x') }] });
  assert.throws(() => scoreReport(bad, RUBRIC, PROFILE()), (err) => err instanceof EvidenceError && /unknown check_id d11\.opens/.test(err.message));
});

test('dimensions 11 and 12 score only from real observed or customer results, and then the ceiling rises by their weight', () => {
  const e = emptyEvidence({ observed: observedFor(['retention_continuing_value', 'measurable_customer_outcomes'], 1, 5) });
  const r = score(e);
  assert.equal(D(r, 'retention_continuing_value').points_earned, 5);
  assert.equal(D(r, 'measurable_customer_outcomes').points_earned, 5);
  assert.equal(D(r, 'retention_continuing_value').status, 'scored');
  assert.equal(r.headline.evidenced_score, 10);
  assert.equal(r.headline.ceiling, 72.2); // 62.2 + 5 + 5
});

test('engagement metrics on the prohibited list are rejected with a finding and never scored', () => {
  const bad = ['session_time', 'Daily Active Users', 'streak_days', 'App Opens', 'notification_ctr', 'weekly_streak_length', 'scroll_depth', 'time_to_return_after_notification', 'variable_reward_effectiveness'];
  for (const metric_id of bad) {
    const e = emptyEvidence({
      observed: [{ dimension: 'retention_continuing_value', source_class: 'observed_behaviour', metric_id, value: 1, n: 500, method: 'Fixture method.', artifact_ref: ref('x') }],
    });
    const r = score(e);
    const d = D(r, 'retention_continuing_value');
    assert.equal(d.points_earned, 0, metric_id);
    assert.equal(d.status, 'not_measured', metric_id);
    assert.equal(r.rejected_evidence.length, 1, metric_id);
    assert.equal(r.rejected_evidence[0].reason_code, 'prohibited_engagement_metric');
    assert.equal(r.rejected_evidence[0].requires_human_review, true);
    assert.match(r.rejected_evidence[0].text, /brain\.dopemine\.md section 2/);
    assert.ok(d.evidence.some((x) => x.disposition === 'rejected' && x.metric_id === metric_id), metric_id);
  }
});

test('a prohibited metric beside a legitimate one: only the legitimate one scores', () => {
  const e = emptyEvidence({
    observed: [
      ...observedFor(['retention_continuing_value'], 1, 5).filter((x) => x.metric_id === 'returning_user_goal_completion'),
      { dimension: 'retention_continuing_value', source_class: 'observed_behaviour', metric_id: 'session_length', value: 1, n: 99, method: 'Fixture method.', artifact_ref: ref('y') },
    ],
  });
  const r = score(e);
  assert.equal(D(r, 'retention_continuing_value').points_earned, 2.5); // 5 x 1 x weight 50/100
  assert.equal(r.rejected_evidence.length, 1);
});

test('an unknown metric, or one of the wrong class, is invalid input rather than silently ignored', () => {
  const unknown = emptyEvidence({ observed: [{ dimension: 'measurable_customer_outcomes', source_class: 'observed_behaviour', metric_id: 'delight_index', value: 1, n: 9, method: 'Fixture method.', artifact_ref: ref('x') }] });
  assert.throws(() => scoreReport(unknown, RUBRIC, PROFILE()), /unknown metric_id delight_index/);
  const wrongClass = emptyEvidence({ observed: [{ dimension: 'measurable_customer_outcomes', source_class: 'customer_feedback', metric_id: 'stated_goal_achieved', value: 1, n: 9, method: 'Fixture method.', artifact_ref: ref('x') }] });
  assert.throws(() => scoreReport(wrongClass, RUBRIC, PROFILE()), /is a observed_behaviour metric, not customer_feedback/);
});

// ---------- builder independence ----------

test('the builder can never be the sole assessor: its assessment of a dimension is rejected', () => {
  const e = withAssessors(emptyEvidence(), BUILDER);
  e.built_by = BUILDER.id;
  e.expert = expertFor(['functional_completeness'], BUILDER, 4);
  const r = score(e);
  const d5 = D(r, 'functional_completeness');
  assert.equal(d5.points_earned, 0);
  assert.equal(d5.components.expert_assessment.assessors_counted, 0);
  assert.equal(r.rejected_evidence[0].reason_code, 'builder_sole_assessor');
  assert.match(r.rejected_evidence[0].text, /never the sole assessor/);
});

test('beside an independent assessor, the builder\'s assessment is recorded but carries no points', () => {
  const e = withAssessors(emptyEvidence(), BUILDER, HUMAN);
  e.built_by = BUILDER.id;
  e.expert = [...expertFor(['functional_completeness'], BUILDER, 4), ...expertFor(['functional_completeness'], HUMAN, 2)];
  const d5 = D(score(e), 'functional_completeness');
  assert.equal(d5.components.expert_assessment.points_earned, 1); // 2 x level 2/4, the human alone
  assert.ok(d5.evidence.some((x) => x.assessor === BUILDER.id && x.disposition === 'recorded_not_counted' && x.reason_code === 'builder_not_counted'));
});

test('the builder rule is per dimension: independent on one dimension does not rescue the builder on another', () => {
  const e = withAssessors(emptyEvidence(), BUILDER, HUMAN);
  e.built_by = BUILDER.id;
  e.expert = [...expertFor(['functional_completeness'], HUMAN, 4), ...expertFor(['functional_completeness', 'trust_transparency'], BUILDER, 4)];
  const r = score(e);
  assert.equal(D(r, 'functional_completeness').components.expert_assessment.assessors_counted, 1);
  assert.equal(D(r, 'trust_transparency').components.expert_assessment.assessors_counted, 0);
  assert.equal(r.rejected_evidence.filter((x) => x.reason_code === 'builder_sole_assessor').length, 1);
});

test('an AI independent of the builder is counted, at the AI-only rate', () => {
  const e = withAssessors(emptyEvidence(), BUILDER, AI_A);
  e.built_by = BUILDER.id;
  e.expert = expertFor(['functional_completeness'], AI_A, 4);
  assert.equal(D(score(e), 'functional_completeness').components.expert_assessment.points_earned, 1);
});

test('the header lists only assessors who contributed, with their kind', () => {
  const e = withAssessors(buildSideEvidence({ assessors: [HUMAN, AI_B] }), HUMAN, AI_B, AI_A);
  assert.deepEqual(score(e).header.assessors, [{ id: AI_B.id, kind: 'ai' }, { id: HUMAN.id, kind: 'human' }].sort((a, b) => (a.id < b.id ? -1 : 1)));
});

// ---------- findings, blockers and precedence ----------

const finding = (extra) => ({ id: 'f1', kind: 'failing_test', detail: 'Fixture finding.', artifact_ref: ref('f'), ...extra });

test('blockers: WCAG A and AA, unsupported claim, failing test, domain override violation, unresolved ethics flag', () => {
  const cases = [
    finding({ id: 'w1', kind: 'wcag_failure', level: 'A', criterion: '1.1.1' }),
    finding({ id: 'w2', kind: 'wcag_failure', level: 'AA', criterion: '1.4.3' }),
    finding({ id: 'c1', kind: 'unsupported_claim' }),
    finding({ id: 't1', kind: 'failing_test' }),
    finding({ id: 'o1', kind: 'domain_override_violation', dimension: 'reliability_error_recovery', principle: 'BXP-04' }),
    finding({ id: 'e1', kind: 'ethics_gate_flag', resolved: false }),
    finding({ id: 'e2', kind: 'ethics_gate_flag' }),
  ];
  for (const f of cases) {
    const r = score(buildSideEvidence({}) && { ...buildSideEvidence(), findings: [f] });
    assert.equal(r.blockers.length, 1, f.id);
    assert.equal(r.blockers[0].finding_id, f.id);
    assert.equal(r.state, 'not_ready', `${f.id}: a blocker prevents even build_verified`);
    assert.ok(r.state_reasons.some((x) => x.code === 'blockers_present'), f.id);
  }
});

test('not blockers: WCAG AAA (advisory) and a resolved ethics-gate flag are recorded but do not block', () => {
  const aaa = score({ ...buildSideEvidence(), findings: [finding({ id: 'w3', kind: 'wcag_failure', level: 'AAA', criterion: '1.4.6' })] });
  assert.equal(aaa.blockers.length, 0);
  assert.equal(aaa.state, 'build_verified');
  assert.equal(aaa.findings_recorded[0].blocker, false);
  assert.match(aaa.findings_recorded[0].text, /recorded as advisory/);
  assert.equal(D(aaa, 'accessibility_inclusion').points_earned, 8.4, 'an advisory finding lowers nothing');
  const resolved = score({ ...buildSideEvidence(), findings: [finding({ id: 'e3', kind: 'ethics_gate_flag', resolved: true })] });
  assert.equal(resolved.blockers.length, 0);
  assert.equal(resolved.state, 'build_verified');
});

test('precedence: a WCAG failure caps accessibility at half its weight, whatever brand dimensions earn', () => {
  // accessibility weight 12; blocking finding caps it at 12 x 0.5 = 6; it would have earned 8.4, so 2.4 is removed.
  const r = score({ ...buildSideEvidence(), findings: [finding({ id: 'w1', kind: 'wcag_failure', level: 'AA', criterion: '1.4.3' })] });
  const d8 = D(r, 'accessibility_inclusion');
  assert.equal(d8.points_earned, 6);
  assert.deepEqual(d8.finding_cap, { max_fraction: 0.5, finding_ids: ['w1'], points_removed: 2.4 });
  assert.equal(r.headline.evidenced_score, 59.8); // 62.2 - 2.4
  // the brand-facing dimensions are untouched and cannot compensate
  assert.equal(D(r, 'brand_distinctiveness').points_earned, 4.2);
  assert.equal(D(r, 'emotional_clarity_positioning').points_earned, 4);
  assert.ok(r.blockers[0].text.includes('WCAG AA failure of criterion 1.4.3'));
});

test('precedence: observed evidence cannot lift a dimension a finding has lowered either', () => {
  const e = buildSideEvidence();
  e.observed = observedFor(['accessibility_inclusion'], 1);
  e.findings = [finding({ id: 'w1', kind: 'wcag_failure', level: 'A', criterion: '2.1.1' })];
  const d8 = D(score(e), 'accessibility_inclusion');
  assert.equal(d8.points_earned, 6); // would be 12 with observed; capped at 12 x 0.5
});

test('two findings on one dimension apply the lowest cap, once', () => {
  const e = { ...buildSideEvidence(), findings: [
    finding({ id: 'a', kind: 'domain_override_violation', dimension: 'trust_transparency' }),
    finding({ id: 'b', kind: 'unsupported_claim' }),
  ] };
  const d6 = D(score(e), 'trust_transparency');
  assert.equal(d6.points_earned, 5); // 10 x 0.5, not 2.5
  assert.deepEqual(d6.finding_cap.finding_ids, ['a', 'b']);
});

test('domain overrides recorded in the profile are copied into the report, sorted, with their origin', () => {
  const r = score(buildSideEvidence());
  assert.deepEqual(r.domain_overrides, [{ principle: 'BXP-04', yields_to: 'safety', reason: 'A fixture override: reassurance never softens a safety alert.', origin: 'fixture-brand@0.1.0' }]);
});

test('finding validation: wcag needs level and criterion; resolved only on ethics flags; domain violations name a dimension', () => {
  const bad = (f, pattern) => assert.throws(() => scoreReport({ ...buildSideEvidence(), findings: [f] }, RUBRIC, PROFILE()), pattern);
  bad(finding({ kind: 'wcag_failure' }), /wcag_failure needs level/);
  bad(finding({ kind: 'wcag_failure', level: 'AA' }), /wcag_failure needs criterion/);
  bad(finding({ kind: 'failing_test', level: 'AA' }), /level only applies to wcag_failure/);
  bad(finding({ kind: 'failing_test', resolved: true }), /resolved only applies to ethics_gate_flag/);
  bad(finding({ kind: 'domain_override_violation' }), /must name the dimension/);
  bad(finding({ kind: 'failing_test', dimension: 'trust_transparency' }), /always affects functional_completeness/);
});

// ---------- confidence ----------

const only = (ids, extras = {}) => {
  const e = withAssessors(emptyEvidence(), HUMAN);
  e.automated = automatedFor(ids, 1);
  e.expert = expertFor(ids, HUMAN, 4);
  return Object.assign(e, extras);
};

test('confidence: no evidence, automated only and expert only are all Low', () => {
  assert.equal(score(emptyEvidence()).confidence.band, 'Low');
  assert.equal(score(emptyEvidence({ automated: automatedFor(MEASURABLE, 1) })).confidence.band, 'Low');
  const e = withAssessors(emptyEvidence(), HUMAN);
  e.expert = expertFor(MEASURABLE, HUMAN, 4);
  assert.equal(score(e).confidence.band, 'Low');
});

test('confidence: Medium needs automated and expert together on at least 50 points of weight (50 yes, 49 no)', () => {
  // weights: usability 12 + accessibility 12 + functional 10 + trust 10 + cross-platform 6 = 50
  const fifty = score(only(['usability_cognitive_load', 'accessibility_inclusion', 'functional_completeness', 'trust_transparency', 'cross_platform_consistency']));
  assert.equal(fifty.confidence.coverage.automated_and_expert_weight, 50);
  assert.equal(fifty.confidence.band, 'Medium');
  // swap cross-platform (6) for craftsmanship (9) -> 12 + 12 + 10 + 9 + 6? use 12 + 12 + 10 + 9 + 6 = 49 with cross-platform kept and trust (10) swapped for craftsmanship (9)
  const fortyNine = score(only(['usability_cognitive_load', 'accessibility_inclusion', 'functional_completeness', 'visual_interaction_craftsmanship', 'cross_platform_consistency']));
  assert.equal(fortyNine.confidence.coverage.automated_and_expert_weight, 49);
  assert.equal(fortyNine.confidence.band, 'Low');
});

test('confidence: disagreement of more than one level between automated and expert drops to Low (0.75 vs level 4 is exactly 1 and passes; 0.74 fails)', () => {
  const all = (autoValue) => only(MEASURABLE, { automated: automatedFor(MEASURABLE, autoValue) });
  // automated 0.75 -> level 3.0; expert level 4; spread 1.0, not more than 1
  const ok = score(all(0.75));
  assert.equal(ok.confidence.disagreements.length, 0);
  assert.equal(ok.confidence.band, 'Medium');
  // automated 0.74 -> level 2.96; spread 1.04 > 1
  const bad = score(all(0.74));
  assert.equal(bad.confidence.disagreements.length, 10);
  assert.equal(bad.confidence.band, 'Low');
  assert.match(bad.confidence.disagreements[0].text, /span 2\.96 to 4; the spread exceeds 1/);
});

test('confidence: two assessors more than one level apart also disagree', () => {
  const second = { id: 'human-two', kind: 'human' };
  const e = withAssessors(buildSideEvidence({ expertLevel: 4 }), second);
  e.expert.push(...expertFor(MEASURABLE, second, 2));
  const r = score(e);
  assert.equal(r.confidence.band, 'Low');
  assert.ok(r.confidence.disagreements.length > 0);
  const near1 = withAssessors(buildSideEvidence({ expertLevel: 4 }), second);
  near1.expert.push(...expertFor(MEASURABLE, second, 3));
  assert.equal(score(near1).confidence.band, 'Medium');
});

test('confidence: High needs two source classes including observed or customer evidence on 50 points of weight (50 yes, 49 no)', () => {
  // automated and expert cover every measurable dimension (Medium on its own); observed evidence decides High.
  const ids50 = ['usability_cognitive_load', 'accessibility_inclusion', 'functional_completeness', 'trust_transparency', 'cross_platform_consistency']; // 12+12+10+10+6
  const ids49 = ['usability_cognitive_load', 'accessibility_inclusion', 'functional_completeness', 'visual_interaction_craftsmanship', 'cross_platform_consistency']; // 12+12+10+9+6
  const hi = score(only(MEASURABLE, { observed: observedFor(ids50, 1) }));
  assert.equal(hi.confidence.coverage.independent_sources_weight, 50);
  assert.equal(hi.confidence.band, 'High');
  const mid = score(only(MEASURABLE, { observed: observedFor(ids49, 1) }));
  assert.equal(mid.confidence.coverage.independent_sources_weight, 49);
  assert.equal(mid.confidence.band, 'Medium');
  // observed behaviour and customer feedback are two classes, so observed evidence of one class alone is not enough
  const oneClass = emptyEvidence({ observed: observedFor(MEASURABLE, 1).filter((x) => x.source_class === 'observed_behaviour') });
  assert.equal(score(oneClass).confidence.coverage.independent_sources_weight, 0);
  assert.equal(score(oneClass).confidence.band, 'Low');
});

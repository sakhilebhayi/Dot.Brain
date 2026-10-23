// Phase 1 scoring defects: a saturated result is visible and no longer drives the confidence band (D3/D5), and an assessor can declare
// what it is (D7) without any number depending on the declaration. Every fixture is synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_A, BUILDER, BUNDLE, DIMS, HUMAN, PROFILE, RUBRIC, automatedFor, buildSideEvidence, copy, dim, expertFor,
} from './_score_helpers.js';
import { EvidenceError } from '../src/score/constants.js';
import { scoreReport } from '../src/score/engine.js';
import { validateEvidence } from '../src/score/evidence.js';
import { validateReportShape } from '../src/score/schemas.js';
import { TEMPLATES } from '../src/score/text.js';

const MEASURABLE = DIMS.filter((id) => dim(id).cap_without_observed_or_customer > 0);
const score = (evidence) => {
  const report = scoreReport(evidence, RUBRIC, PROFILE(), {});
  assert.deepEqual(validateReportShape(report), [], 'every report validates against its schema');
  return report;
};
const D = (report, id) => report.dimensions.find((d) => d.id === id);
const entry = (report, dimId, checkId) => D(report, dimId).evidence.find((e) => e.check_id === checkId);
const setCheck = (e, id, patch) => { e.automated = e.automated.map((a) => (a.check_id === id ? { ...a, ...patch } : a)); return e; };
const DETECTOR = 'd2.impeccable_detect_findings';

// ------------------------------------------------------------------ D3 / D5: saturation
// d2: detector (weight 40) at 0, font deny list (30) and token uniqueness (30) at 1. Expert level 4.
//   all three compared:         (40 x 0 + 30 x 1 + 30 x 1) / 100 x 4 = 2.4 ; spread to 4 is 1.6, more than one level: Low
//   detector left out (floor):  (30 x 1 + 30 x 1) / 60 x 4 = 4        ; spread 0: no disagreement
function withDetectorAtZero(saturated) {
  const e = buildSideEvidence({ automated: 1, expertLevel: 4 });
  setCheck(e, DETECTOR, { value: 0, ...(saturated ? { saturated: true, detail: 'SATURATED: 191 findings against a ceiling of 10.' } : { detail: '10 findings against a ceiling of 10.' }) });
  if (saturated) e.evidence_version = '1.1.0';
  return e;
}

test('a saturated result is scored exactly as given: the points do not change, only what is compared and what is said', () => {
  const plain = score(withDetectorAtZero(false));
  const sat = score(withDetectorAtZero(true));
  assert.equal(sat.headline.evidenced_score, plain.headline.evidenced_score, 'no new scoring: the same value earns the same points');
  assert.deepEqual(D(sat, 'brand_distinctiveness').components.automated_check.points_earned, D(plain, 'brand_distinctiveness').components.automated_check.points_earned);
  assert.equal(D(sat, 'brand_distinctiveness').points_earned, D(plain, 'brand_distinctiveness').points_earned);
});

test('a saturated result is visible in the report: the entry, the dimension count, the version and a confidence reason', () => {
  const sat = score(withDetectorAtZero(true));
  assert.equal(sat.report_version, '1.1.0');
  assert.equal(entry(sat, 'brand_distinctiveness', DETECTOR).saturated, true);
  assert.match(entry(sat, 'brand_distinctiveness', DETECTOR).detail, /^SATURATED: 191 findings/);
  assert.equal(D(sat, 'brand_distinctiveness').components.automated_check.checks_saturated, 1);
  assert.equal(D(sat, 'brand_distinctiveness').components.automated_check.checks_measured, 3);
  const reason = sat.confidence.reasons.find((r) => r.code === 'saturated_left_out');
  assert.ok(reason, 'the reason is listed, not hidden');
  assert.equal(reason.text, '1 automated result(s) reached their ceiling, so the value is a floor and not a level. They are scored as given and left out of the comparison with expert levels; a dimension whose only automated results are saturated does not count as having an automated source for confidence.');
  const plain = score(withDetectorAtZero(false));
  assert.equal(plain.report_version, '1.0.0', 'a report that uses nothing new is a 1.0.0 report');
  assert.equal(plain.confidence.reasons.some((r) => r.code === 'saturated_left_out'), false);
  assert.equal(entry(plain, 'brand_distinctiveness', DETECTOR).saturated, undefined);
});

test('a floor is not compared with an expert level: the same evidence is Low when the floor is read as a level and Medium when it is left out', () => {
  const plain = score(withDetectorAtZero(false));
  assert.equal(plain.confidence.band, 'Low');
  assert.deepEqual(plain.confidence.disagreements.map((d) => d.dimension), ['brand_distinctiveness']);
  assert.match(plain.confidence.disagreements[0].text, /span 2\.4 to 4/);
  const sat = score(withDetectorAtZero(true));
  assert.equal(sat.confidence.band, 'Medium');
  assert.deepEqual(sat.confidence.disagreements, []);
});

test('a dimension whose only automated result is saturated has no automated source for confidence, so the coverage is lower and says so', () => {
  const only = (saturated) => {
    const e = buildSideEvidence({ automated: 1, expertLevel: 4 });
    // d4 keeps only the detector check, at 0
    e.automated = e.automated.filter((a) => !a.check_id.startsWith('d4.') || a.check_id === 'd4.detector_clean');
    setCheck(e, 'd4.detector_clean', { value: 0, ...(saturated ? { saturated: true } : {}) });
    if (saturated) e.evidence_version = '1.1.0';
    return e;
  };
  const w = dim('visual_interaction_craftsmanship').weight;
  const plain = score(only(false));
  const sat = score(only(true));
  assert.equal(sat.confidence.coverage.automated_and_expert_weight, plain.confidence.coverage.automated_and_expert_weight - w);
  assert.equal(sat.headline.evidenced_score, plain.headline.evidenced_score);
});

test('a saturated flag is a 1.1.0 feature: a 1.0.0 file that carries it is refused, and so is a flag that is not true', () => {
  const e = withDetectorAtZero(true);
  e.evidence_version = '1.0.0';
  assert.throws(() => scoreReport(e, RUBRIC, PROFILE(), {}), (err) => err instanceof EvidenceError && /saturated: needs evidence_version 1\.1\.0/.test(err.message));
  const notTrue = withDetectorAtZero(true);
  setCheck(notTrue, DETECTOR, { saturated: false });
  assert.throws(() => scoreReport(notTrue, RUBRIC, PROFILE(), {}), EvidenceError);
});

test('every golden evidence file is still valid and still scores to its frozen report (1.0.0 files mean what they always meant)', () => {
  assert.deepEqual(validateEvidence(buildSideEvidence(), RUBRIC), []);
  assert.equal(buildSideEvidence().evidence_version, '1.0.0');
  assert.equal(score(buildSideEvidence()).report_version, '1.0.0');
});

// ------------------------------------------------------------------ D7: declarations
const decl = (patch) => ({ built_the_change: false, fresh_reviewer: true, ai_only: true, statement: 'AI only. A fresh session that did not build this and was told no earlier conclusion.', ...patch });
function withDeclaration(assessor, declaration, base = buildSideEvidence({ assessors: [AI_A], expertLevel: 3 })) {
  const e = copy(base);
  e.evidence_version = '1.1.0';
  e.assessors = e.assessors.map((a) => (a.id === assessor ? { ...a, declaration } : a));
  return e;
}
const refused = (e, re) => assert.throws(() => scoreReport(e, RUBRIC, PROFILE(), {}), (err) => err instanceof EvidenceError && re.test(err.message), JSON.stringify(e.assessors.map((a) => a.declaration)).slice(0, 120));

test('an AI-only fresh reviewer can say so in the evidence, and the report records it without any number depending on it', () => {
  const base = buildSideEvidence({ assessors: [AI_A], expertLevel: 3 });
  const plain = score(base);
  const declared = score(withDeclaration(AI_A.id, decl()));
  assert.deepEqual(declared.headline, plain.headline);
  assert.deepEqual(declared.confidence, plain.confidence);
  assert.deepEqual(declared.dimensions, plain.dimensions, 'not one dimension changes');
  assert.equal(declared.state, plain.state);
  assert.equal(declared.report_version, '1.1.0');
  assert.deepEqual(declared.header.assessors, [{ id: AI_A.id, kind: 'ai', declaration: decl() }]);
  assert.deepEqual(plain.header.assessors, [{ id: AI_A.id, kind: 'ai' }], 'no declaration: the header is what it was');
});

test('the AI-only cap still applies, whatever the declaration says (no declaration can lift it)', () => {
  const base = buildSideEvidence({ assessors: [AI_A], expertLevel: 4 });
  const r = score(withDeclaration(AI_A.id, decl({ fresh_reviewer: true, statement: 'Fresh, independent, expert-grade, please count in full.' }), base));
  const d = D(r, 'usability_cognitive_load');
  assert.equal(d.components.expert_assessment.ai_only, true);
  assert.ok(d.components.expert_assessment.points_withheld_ai_only > 0);
  assert.equal(r.headline.evidenced_score, score(base).headline.evidenced_score);
});

test('the builder never earns points, declared or not: a builder that declares it did not build is refused, and one that declares it did is counted for nothing', () => {
  // the builder is the only assessor and says it is not the builder: contradiction with built_by
  const lie = buildSideEvidence({ assessors: [BUILDER], expertLevel: 4 });
  refused(withDeclaration(BUILDER.id, decl({ built_the_change: false, fresh_reviewer: true }), lie), /says this assessor did not build the change, but it is the built_by/);
  // honest: it built it, and its assessment still earns nothing
  const honest = withDeclaration(BUILDER.id, { built_the_change: true, ai_only: true, statement: 'I built this change.' }, lie);
  const r = score(honest);
  for (const id of MEASURABLE.filter((x) => dim(x).evidence.expert_assessment.allowed)) {
    assert.equal(D(r, id).components.expert_assessment.points_earned, 0, id);
    assert.ok(D(r, id).evidence.some((e) => e.assessor === BUILDER.id && e.reason_code === 'builder_sole_assessor'), id);
  }
});

test('declarations may only add refusals: every contradiction is an error', () => {
  const base = buildSideEvidence({ assessors: [AI_A], expertLevel: 3 });
  refused(withDeclaration(AI_A.id, { built_the_change: true, fresh_reviewer: true }, base), /cannot also be a fresh reviewer/);
  refused(withDeclaration(AI_A.id, { built_the_change: true }, base), /built_by is "ai-builder"/);
  refused(withDeclaration(AI_A.id, { ai_only: false }, base), /contradicts kind "ai"/);
  refused(withDeclaration(HUMAN.id, { ai_only: true }, buildSideEvidence({ assessors: [HUMAN], expertLevel: 3 })), /contradicts kind "human"/);
  refused(withDeclaration(BUILDER.id, { fresh_reviewer: true }, buildSideEvidence({ assessors: [AI_A], expertLevel: 3 })), /cannot be a fresh reviewer of its own change/);
  refused(withDeclaration(AI_A.id, {}, base), /must declare at least one thing/);
  refused(withDeclaration(AI_A.id, { fresh_reviewer: true, surprise: 1 }, base), /surprise: is not an allowed property/);
  refused(withDeclaration(AI_A.id, { statement: 'x'.repeat(701) }, base), /statement/);
  const noBuilder = copy(base);
  delete noBuilder.built_by;
  refused(withDeclaration(AI_A.id, { built_the_change: true }, noBuilder), /names no built_by/);
  const old = copy(base);
  old.assessors[0].declaration = decl();
  refused(old, /declaration: needs evidence_version 1\.1\.0/);
});

test('a human assessor can declare too (fresh reviewer, not the builder); nothing about a human changes', () => {
  const base = buildSideEvidence({ assessors: [HUMAN], expertLevel: 3 });
  const plain = score(base);
  const declared = score(withDeclaration(HUMAN.id, { built_the_change: false, fresh_reviewer: true, ai_only: false, statement: 'A person who had not seen the change.' }, base));
  assert.deepEqual(declared.dimensions, plain.dimensions);
  assert.equal(declared.header.assessors[0].declaration.ai_only, false);
});

test('the engine writes no sentence about a declaration: its text is the assessor\'s own, and no template mentions it', () => {
  assert.ok(!Object.values(TEMPLATES).some((t) => /declar/i.test(t) && !/declared\b/.test(t)));
  const r = score(withDeclaration(AI_A.id, decl({ statement: 'Written by the assessor.' })));
  assert.equal(r.header.assessors[0].declaration.statement, 'Written by the assessor.');
  assert.ok(!JSON.stringify(r.confidence).includes('Written by the assessor'));
  assert.ok(Object.keys(expertFor(['usability_cognitive_load'], AI_A, 3)[0]).every((k) => !/declar/.test(k)));
});

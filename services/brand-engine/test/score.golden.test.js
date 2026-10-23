// Golden tests: bxqs-1.0.0 frozen against fixture evidence sets. Every
// evidence file and every report here is a SYNTHETIC TEST FIXTURE (see the
// x-fixture-notice field); none is a measurement of any product.
//
// If one of these fails, a released score changed. That is a methodology
// change: it needs a new rubric version (or an engine fix the owner agrees
// is a bug), never an edit to the golden file to make the test pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableStringify } from '../src/json.js';
import { scoreReport } from '../src/score/engine.js';
import { validateReportShape } from '../src/score/schemas.js';
import { BUNDLE, RUBRIC } from './_score_helpers.js';

const DIR = fileURLToPath(new URL('./fixtures/score/golden/', import.meta.url));
const read = (name) => JSON.parse(readFileSync(join(DIR, name), 'utf8'));
const PROFILE = read('profile.fixture.json');
const RATIFICATION = { rubric_sha256: BUNDLE.sha256, approver: { id: 'fixture-owner', kind: 'human' }, ratified_at: '2026-10-30T09:00:00Z' };
const names = readdirSync(DIR).filter((f) => f.endsWith('.evidence.json')).map((f) => f.replace('.evidence.json', '')).sort();

const run = (name) => {
  const evidence = read(`${name}.evidence.json`);
  const profile = { ...PROFILE, effective_status: evidence['x-golden'].profile_status };
  return scoreReport(evidence, RUBRIC, profile, { rubricRatification: evidence['x-golden'].rubric_ratified ? RATIFICATION : null });
};

test('there are seven golden scenarios, each with evidence and an expected report', () => {
  assert.deepEqual(names, ['ai-expert-only', 'automated-only', 'build-verified-human-expert', 'builder-sole-assessor', 'pilot-release-ready', 'prohibited-metric', 'wcag-blocker']);
  for (const n of names) assert.ok(readFileSync(join(DIR, `${n}.report.json`), 'utf8').length > 1000, n);
});

for (const name of names) {
  test(`golden ${name}: the report is byte-identical to the frozen one and valid`, () => {
    const report = run(name);
    assert.deepEqual(validateReportShape(report), []);
    assert.equal(`${stableStringify(report)}\n`, readFileSync(join(DIR, `${name}.report.json`), 'utf8'));
    assert.equal(report.header.rubric.sha256, BUNDLE.sha256, 'every golden report is for the pinned rubric');
    assert.equal(report.header.rubric.version, '1.0.0');
  });
}

test('golden headline numbers and states, written out so a reviewer can see what is frozen', () => {
  const expect = {
    'automated-only': [32.72, 62.2, 52.61, 'not_ready', 'Low'],
    'ai-expert-only': [42, 62.2, 67.53, 'not_ready', 'Medium'],
    'build-verified-human-expert': [61.45, 62.2, 98.8, 'build_verified', 'Medium'],
    'wcag-blocker': [59.8, 62.2, 96.14, 'not_ready', 'Medium'],
    'prohibited-metric': [4, 67.2, 5.95, 'not_ready', 'Low'],
    'builder-sole-assessor': [7, 62.2, 11.25, 'not_ready', 'Low'],
    'pilot-release-ready': [100, 100, 100, 'release_ready', 'High'],
  };
  for (const [name, [evidenced, ceiling, attainment, state, band]] of Object.entries(expect)) {
    const r = run(name);
    assert.deepEqual([r.headline.evidenced_score, r.headline.ceiling, r.headline.attainment_percent, r.state, r.confidence.band], [evidenced, ceiling, attainment, state, band], name);
  }
});

test('golden scenarios exercise the rules they are named for', () => {
  const sole = run('builder-sole-assessor');
  assert.equal(sole.rejected_evidence[0].reason_code, 'builder_sole_assessor');
  const dau = run('prohibited-metric');
  assert.equal(dau.rejected_evidence[0].reason_code, 'prohibited_engagement_metric');
  assert.equal(dau.dimensions.find((d) => d.id === 'retention_continuing_value').status, 'not_measured');
  const wcag = run('wcag-blocker');
  assert.equal(wcag.blockers[0].kind, 'wcag_failure');
  assert.equal(wcag.dimensions.find((d) => d.id === 'accessibility_inclusion').points_earned, 6);
  const ai = run('ai-expert-only');
  assert.ok(ai.dimensions.some((d) => d.components.expert_assessment.ai_only));
  assert.equal(run('pilot-release-ready').state, 'release_ready');
});

test('every golden evidence file is marked as a synthetic fixture and names no real product', () => {
  for (const n of names) {
    const e = read(`${n}.evidence.json`);
    assert.match(e['x-fixture-notice'], /Synthetic test fixture/, n);
    assert.equal(e.input.repo, 'fixtures/synthetic-product', n);
  }
});

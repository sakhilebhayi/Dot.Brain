// The rubric as data: shape, arithmetic, immutability, ratification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND, ROOT, clone, copyBrandDir, readJsonFile, runCli, shipped, writeJson } from './_helpers.js';
import { RUBRIC } from './_score_helpers.js';
import { checkRatificationRecord, checkRubric, latestRubricRef, loadRubric, matchProhibited, rubricHash } from '../src/score/rubric.js';
import { Refused } from '../src/score/constants.js';
import { validateRubricShape } from '../src/score/schemas.js';

// Pinned by hand. A released rubric is immutable: if this test fails, the file
// changed. The fix is a NEW rubric version, never a new hash here.
const BXQS_1_0_0_SHA256 = 'f5a4f8cb49b821bb41cb2ea3a5355089f87e60e6233cc6439a0f7ea680342bbd';

// The owner's accepted table, written out independently of the file.
const OWNER_TABLE = [
  ['emotional_clarity_positioning', 8, 0.5], ['brand_distinctiveness', 7, 0.6], ['usability_cognitive_load', 12, 0.6],
  ['visual_interaction_craftsmanship', 9, 0.8], ['functional_completeness', 10, 0.9], ['trust_transparency', 10, 0.7],
  ['perceived_demonstrated_value', 8, 0.5], ['accessibility_inclusion', 12, 0.7], ['cross_platform_consistency', 6, 0.8],
  ['reliability_error_recovery', 8, 0.8], ['retention_continuing_value', 5, 0], ['measurable_customer_outcomes', 5, 0],
];

test('the released rubric hash is pinned: any edit to bxqs-1.0.0.json fails here', () => {
  assert.equal(rubricHash(RUBRIC), BXQS_1_0_0_SHA256);
  const ledger = readJsonFile(join(BRAND, 'rubrics', 'released.json'));
  assert.equal(ledger.released.bxqs['1.0.0'].sha256, BXQS_1_0_0_SHA256, 'the ledger and this test must agree');
});

test('the hash is of the canonical JSON, so reformatting the file cannot change it', () => {
  const pretty = JSON.parse(JSON.stringify(RUBRIC, null, 8));
  const shuffled = Object.fromEntries(Object.entries(pretty).reverse());
  assert.equal(rubricHash(shuffled), BXQS_1_0_0_SHA256);
});

test('twelve dimensions, weights and caps exactly as the owner accepted them, summing to exactly 100', () => {
  assert.deepEqual(RUBRIC.dimensions.map((d) => [d.id, d.weight, d.cap_without_observed_or_customer]), OWNER_TABLE);
  assert.equal(RUBRIC.dimensions.reduce((s, d) => s + d.weight, 0), 100);
  assert.equal(RUBRIC.policy.total_points, 100);
});

test('the dimension ids are the ones the framework principles already name', () => {
  const principleSchema = readJsonFile(`${ROOT}schemas/brand-principle.schema.json`);
  assert.deepEqual(RUBRIC.dimensions.map((d) => d.id), principleSchema.$defs.rubricDimension.enum);
  const fed = new Set([...shipped().principles.values()].flatMap((p) => p.rubric_dimensions));
  assert.deepEqual([...fed].sort(), RUBRIC.dimensions.map((d) => d.id).sort());
});

test('the rubric validates against its schema and its own cross-field rules', () => {
  assert.deepEqual(validateRubricShape(RUBRIC), []);
  assert.deepEqual(checkRubric(RUBRIC), []);
});

test('policy numbers are the owner\'s decisions', () => {
  assert.equal(RUBRIC.policy.release_evidenced_minimum, 90);
  assert.equal(RUBRIC.policy.build_verified_attainment_minimum, 90);
  assert.equal(RUBRIC.policy.ai_only_expert_credit, 0.5);
  assert.equal(RUBRIC.policy.expert_level_max, 4);
  assert.equal(RUBRIC.policy.confidence_minimum_weight, 50);
  assert.equal(RUBRIC.policy.disagreement_levels, 1);
});

test('a ceiling of about 62 points with automated and expert evidence alone: weight x cap summed (stated, not assumed)', () => {
  // 8x0.5=4  7x0.6=4.2  12x0.6=7.2  9x0.8=7.2  10x0.9=9  10x0.7=7  8x0.5=4  12x0.7=8.4  6x0.8=4.8  8x0.8=6.4  5x0=0  5x0=0
  // 4 + 4.2 + 7.2 + 7.2 + 9 + 7 + 4 + 8.4 + 4.8 + 6.4 = 62.2
  const ceiling = RUBRIC.dimensions.reduce((s, d) => s + d.weight * d.cap_without_observed_or_customer, 0);
  assert.equal(Math.round(ceiling * 1000) / 1000, 62.2);
});

test('the cap is exactly the automated plus expert share, so what is left is reserved for observed or customer evidence', () => {
  for (const d of RUBRIC.dimensions) {
    const { automated_check: a, expert_assessment: x, observed_or_customer: o } = d.shares;
    assert.equal(Math.round((a + x) * 1e6), Math.round(d.cap_without_observed_or_customer * 1e6), d.id);
    assert.equal(Math.round((a + x + o) * 1e6), 1e6, d.id);
  }
});

test('dimensions 11 and 12 are not measurable without observed or customer evidence and allow no automated or expert evidence', () => {
  for (const id of ['retention_continuing_value', 'measurable_customer_outcomes']) {
    const d = RUBRIC.dimensions.find((x) => x.id === id);
    assert.equal(d.cap_without_observed_or_customer, 0);
    assert.equal(d.measurable_without_observed_or_customer, false);
    assert.equal(d.evidence.automated_check.allowed, false);
    assert.equal(d.evidence.expert_assessment.allowed, false);
    assert.equal(d.evidence.observed_behaviour.allowed && d.evidence.customer_feedback.allowed, true);
    assert.equal(d.floor, 0);
    assert.match(d.description, /outcome|goal/i);
  }
  assert.match(RUBRIC.dimensions[10].description, /NEVER app opens, streaks, session time/);
});

test('every measurable dimension defines checks (the analyser contract) and anchored expert levels 0 to 4', () => {
  for (const d of RUBRIC.dimensions.filter((x) => x.cap_without_observed_or_customer > 0)) {
    assert.ok(d.evidence.automated_check.checks.length >= 3, d.id);
    assert.equal(d.evidence.automated_check.checks.reduce((s, c) => s + c.weight, 0), 100, d.id);
    assert.deepEqual(d.evidence.expert_assessment.levels.map((l) => l.level), [0, 1, 2, 3, 4], d.id);
    for (const l of d.evidence.expert_assessment.levels) assert.ok(l.anchor.length > 30, `${d.id} level ${l.level} needs a real anchor`);
    for (const c of d.evidence.automated_check.checks) assert.match(c.id, new RegExp(`^d${d.order}\\.`));
  }
});

test('check and metric ids are unique across the rubric, and the contract ids named in the brief are present', () => {
  const ids = RUBRIC.dimensions.flatMap((d) => [
    ...d.evidence.automated_check.checks, ...d.evidence.observed_behaviour.metrics, ...d.evidence.customer_feedback.metrics,
  ].map((c) => c.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ['d1.copy_profile_language_lint', 'd2.impeccable_detect_findings', 'd3.nav_depth', 'd3.task_flow_step_counts', 'd4.reduced_motion', 'd5.dead_links', 'd6.claim_lint', 'd6.consent_handling', 'd7.time_to_first_result', 'd8.token_pair_contrast', 'd8.axe_violations', 'd9.principle_diff', 'd10.health_endpoint']) {
    assert.ok(ids.includes(id), id);
  }
});

test('cross-platform consistency measures shared principles, not visual sameness', () => {
  const d9 = RUBRIC.dimensions[8];
  assert.match(d9.description, /PRINCIPLES/);
  assert.match(d9.description, /does not ask for visual sameness/);
  assert.match(d9.evidence.automated_check.checks.find((c) => c.id === 'd9.principle_diff').measures, /not a visual diff/);
});

test('no engagement metric is accepted anywhere, and the prohibited list covers brain.dopemine.md section 2', () => {
  const accepted = RUBRIC.dimensions.flatMap((d) => [...d.evidence.observed_behaviour.metrics, ...d.evidence.customer_feedback.metrics].map((m) => m.id));
  for (const id of accepted) assert.equal(matchProhibited(RUBRIC, id), null, `${id} must not be a prohibited metric`);
  const ids = RUBRIC.prohibited_metrics.map((p) => p.id);
  for (const id of ['session_time', 'app_opens', 'scroll_depth', 'notification_click_through', 'streak_length', 'variable_reward_effectiveness', 'time_to_return']) assert.ok(ids.includes(id), id);
  for (const p of RUBRIC.prohibited_metrics) assert.match(p.source, /brain\.dopemine\.md section 2/);
});

test('matchProhibited recognises ids, aliases and whole-word runs, and nothing legitimate', () => {
  for (const bad of ['session_time', 'Session Time', 'daily_active_users', 'DAU', 'app-opens', 'weekly_streak_length', 'notification_CTR', 'time_to_return_after_notification', 'scroll depth']) {
    assert.ok(matchProhibited(RUBRIC, bad), bad);
  }
  for (const ok of ['task_completion_rate', 'time_on_task', 'first_session_goal_reached', 'reopens_the_report_to_finish', 'disopens']) {
    assert.equal(matchProhibited(RUBRIC, ok), null, ok);
  }
});

test('finding effects: the five blockers, each with a dimension or a requirement to name one', () => {
  assert.deepEqual(RUBRIC.finding_effects.map((f) => f.kind), ['wcag_failure', 'unsupported_claim', 'failing_test', 'domain_override_violation', 'ethics_gate_flag']);
  assert.deepEqual(RUBRIC.finding_effects[0].blocker_levels, ['A', 'AA']);
  assert.equal(RUBRIC.finding_effects[0].dimension, 'accessibility_inclusion');
});

test('the rubric carries a semver policy and no private or token-like material', () => {
  assert.match(RUBRIC.semver_policy.major, /dimension set, a weight or a cap/);
  const text = readFileSync(join(BRAND, 'rubrics', 'bxqs-1.0.0.json'), 'utf8');
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text), 'email-like string');
  assert.ok(!/\/Users\/|\/home\/|C:\\\\/.test(text), 'local path');
  assert.ok(!/(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|Bearer\s+\S|AKIA[0-9A-Z]{8}|-----BEGIN)/.test(text), 'token-like string');
});

// ---------- checkRubric rejects each way a rubric can be wrong ----------

const broken = (mutate) => { const r = clone(RUBRIC); mutate(r); return checkRubric(r); };
const first = (r) => r.dimensions[0];

test('checkRubric: weights that do not sum to exactly 100', () => {
  assert.match(broken((r) => { first(r).weight = 9; }).join('\n'), /weights sum to 101, not exactly 100/);
  assert.match(broken((r) => { first(r).weight = 7; }).join('\n'), /weights sum to 99/);
});

test('checkRubric: a cap that is not the automated plus expert share', () => {
  assert.match(broken((r) => { first(r).cap_without_observed_or_customer = 0.55; }).join('\n'), /must equal the automated plus expert share/);
});

test('checkRubric: shares that do not sum to one; check weights not 100; duplicate ids; missing level', () => {
  assert.match(broken((r) => { first(r).shares.observed_or_customer = 0.4; }).join('\n'), /shares must sum to 1/);
  assert.match(broken((r) => { first(r).evidence.automated_check.checks[0].weight = 41; }).join('\n'), /check weights sum to 101/);
  assert.match(broken((r) => { first(r).evidence.automated_check.checks[1].id = first(r).evidence.automated_check.checks[0].id; }).join('\n'), /duplicate id/);
  assert.match(broken((r) => { first(r).evidence.expert_assessment.levels.pop(); }).join('\n'), /exactly 0 to 4/);
  assert.match(broken((r) => { first(r).evidence.automated_check.checks[0].id = 'd2.copy_profile_language_lint'; }).join('\n'), /must start with d1\./);
});

test('checkRubric: outcome-defined dimensions cannot take automated or expert evidence', () => {
  const msg = broken((r) => { r.dimensions[10].evidence.expert_assessment.allowed = true; r.dimensions[10].shares.expert_assessment = 0.1; }).join('\n');
  assert.match(msg, /retention_continuing_value/);
});

test('checkRubric: dimension set and order are fixed; a prohibited metric may not also be accepted', () => {
  assert.match(broken((r) => { r.dimensions.reverse(); }).join('\n'), /fixed order/);
  assert.match(broken((r) => { r.prohibited_metrics[0].aliases.push('task_completion_rate'); }).join('\n'), /also an accepted metric/);
});

test('the schema rejects a missing field, an unknown field and a wrong dimension count', () => {
  const r = clone(RUBRIC);
  delete r.policy;
  assert.ok(validateRubricShape(r).some((m) => /policy: is required/.test(m)));
  const s = clone(RUBRIC);
  s.dimensions.pop();
  assert.ok(validateRubricShape(s).some((m) => /at least 12/.test(m)));
  const t = clone(RUBRIC);
  t.extra = 1;
  assert.ok(validateRubricShape(t).some((m) => /not an allowed property/.test(m)));
});

// ---------- release, immutability, ratification ----------

test('the shipped rubric loads, is released and is proposed (the owner has not ratified it)', () => {
  const b = loadRubric(BRAND);
  assert.equal(b.ref, 'bxqs-1.0.0');
  assert.equal(b.sha256, BXQS_1_0_0_SHA256);
  assert.equal(b.ratification, null);
  assert.equal(latestRubricRef(BRAND), 'bxqs-1.0.0');
});

test('a released rubric that has been edited is refused, not scored with', () => {
  const dir = copyBrandDir();
  const path = join(dir, 'rubrics', 'bxqs-1.0.0.json');
  const r = readJsonFile(path);
  r.dimensions[0].description += ' (edited)';
  writeJson(path, r);
  assert.throws(() => loadRubric(dir, 'bxqs-1.0.0'), (e) => e instanceof Refused && /modified since release/.test(e.message) && /immutable/.test(e.message));
});

test('a rubric that is not in the released ledger is refused', () => {
  const dir = copyBrandDir();
  const r = readJsonFile(join(dir, 'rubrics', 'bxqs-1.0.0.json'));
  r.version = '1.0.1';
  writeJson(join(dir, 'rubrics', 'bxqs-1.0.1.json'), r);
  assert.throws(() => loadRubric(dir, 'bxqs-1.0.1'), (e) => e instanceof Refused && /not in released\.json/.test(e.message));
  assert.throws(() => loadRubric(dir, 'bxqs-9.9.9'), Refused);
  assert.throws(() => loadRubric(dir, 'nonsense'), /must look like/);
});

test('a ratification record is honoured only for the exact hash it names, and only from a human', () => {
  const dir = copyBrandDir();
  const rec = {
    rubric_id: 'bxqs', rubric_version: '1.0.0', rubric_sha256: BXQS_1_0_0_SHA256, status: 'ratified',
    approver: { id: 'fixture-owner', kind: 'human' }, ratified_at: '2026-10-30T09:00:00Z',
  };
  writeJson(join(dir, 'rubrics', 'bxqs-1.0.0.ratification.json'), rec);
  const b = loadRubric(dir, 'bxqs-1.0.0');
  assert.equal(b.ratification.approver.id, 'fixture-owner');
  assert.equal(b.sha256, BXQS_1_0_0_SHA256, 'ratifying does not change the rubric file or its hash');

  const ctx = { id: 'bxqs', version: '1.0.0', sha256: BXQS_1_0_0_SHA256 };
  assert.deepEqual(checkRatificationRecord(rec, ctx), []);
  assert.match(checkRatificationRecord({ ...rec, rubric_sha256: 'f'.repeat(64) }, ctx).join(), /different rubric hash/);
  assert.match(checkRatificationRecord({ ...rec, approver: { id: 'ai-session', kind: 'ai' } }, ctx).join(), /human/);
  assert.match(checkRatificationRecord({ ...rec, status: 'proposed' }, ctx).join(), /must be "ratified"/);
  assert.match(checkRatificationRecord({ ...rec, ratified_at: 'yesterday' }, ctx).join(), /date-time/);
  assert.match(checkRatificationRecord({ ...rec, rubric_version: '1.0.1' }, ctx).join(), /not bxqs@1\.0\.0|names bxqs@1\.0\.1/);

  writeJson(join(dir, 'rubrics', 'bxqs-1.0.0.ratification.json'), { ...rec, approver: { id: 'ai-session', kind: 'ai' } });
  assert.throws(() => loadRubric(dir, 'bxqs-1.0.0'), Refused);
});

test('rubric validate and show work from the CLI and are deterministic', () => {
  const v = runCli(['rubric', 'validate']);
  assert.equal(v.code, 0, v.stderr);
  assert.match(v.stdout, new RegExp(`^ok bxqs-1\\.0\\.0 sha256=${BXQS_1_0_0_SHA256} weights=100 dimensions=12 proposed \\(not ratified\\)$`, 'm'));
  const s1 = runCli(['rubric', 'show', 'bxqs-1.0.0']);
  assert.equal(s1.code, 0);
  assert.equal(JSON.parse(s1.stdout).version, '1.0.0');
  assert.equal(s1.stdout, runCli(['rubric', 'show']).stdout);
});

test('rubric validate refuses (exit 3) a modified rubric', () => {
  const dir = copyBrandDir();
  const path = join(dir, 'rubrics', 'bxqs-1.0.0.json');
  const r = readJsonFile(path);
  r.title = 'Changed';
  writeJson(path, r);
  const out = runCli(['rubric', 'validate', '--brand-dir', dir]);
  assert.equal(out.code, 3);
  assert.match(out.stderr, /modified since release/);
});

test('the brand directory still validates with the rubrics directory present', () => {
  const r = runCli(['profile', 'validate']);
  assert.equal(r.code, 0, r.stderr);
  const unused = mkdtempSync(join(tmpdir(), 'x-'));
  cpSync(BRAND, unused, { recursive: true });
  writeFileSync(join(unused, 'rubrics', 'stray.txt'), 'x');
  assert.equal(runCli(['profile', 'validate', '--brand-dir', unused]).code, 0);
});

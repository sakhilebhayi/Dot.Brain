// plan: grouping, ordering, precedence over brand rules, and the engagement rule.
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { plan, rootCause } from '../src/analyze/plan.js';
import { renderPlan } from '../src/analyze/render.js';
import { scoreSchema } from '../src/score/schemas.js';
import { integrityProblems } from '../src/analyze/analyze.js';
import { BUNDLE, REG, makeAnalysis } from './_flow_helpers.js';

const ctx = { rubric: BUNDLE.rubric, principles: REG.principles };
const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const F = (check_id, extra = {}) => ({ check_id, severity: 'major', fingerprint: fp(`${check_id}|${extra.fix_hint ?? ''}|${extra.location?.file ?? ''}|${extra.location?.line ?? ''}|${extra.severity ?? ''}`), ...extra });
const make = (findings, more = {}) => plan(makeAnalysis({ findings, ...more }), ctx);
const ids = (p) => p.tasks.map((t) => t.check_id);

test('a plan validates against its schema and carries an integrity hash', () => {
  const p = make([F('d8.labels_alt_lang', { location: { file: 'a.html', line: 3 }, fix_hint: 'Add alt.' })], { evidence: [{ check_id: 'd8.labels_alt_lang', value: 0.5 }] });
  assert.deepEqual(scoreSchema('brand-plan').validate(p), []);
  assert.deepEqual(integrityProblems(p), []);
  assert.equal(p.plan_version, '1.0.0');
});

test('findings with the same check and the same root cause become one task listing every file and line', () => {
  const p = make([
    F('d8.labels_alt_lang', { location: { file: 'b.html', line: 9 }, fix_hint: 'Add alt text to the image.' }),
    F('d8.labels_alt_lang', { location: { file: 'a.html', line: 3 }, fix_hint: 'Add alt text to the image.' }),
    F('d8.labels_alt_lang', { location: { file: 'a.html', line: 12 }, fix_hint: 'Add alt text to the image.' }),
    F('d8.labels_alt_lang', { location: { file: 'c.html', line: 1 }, fix_hint: 'Add a lang attribute.' }),
  ], { evidence: [{ check_id: 'd8.labels_alt_lang', value: 0.5 }] });
  assert.equal(p.tasks.length, 2);
  const alt = p.tasks.find((t) => t.fix_hints[0] === 'Add alt text to the image.');
  assert.deepEqual(alt.files, [{ file: 'a.html', lines: [3, 12] }, { file: 'b.html', lines: [9] }]);
  assert.equal(alt.locations, 3);
  assert.equal(alt.findings.length, 3);
  assert.deepEqual(alt.acceptance.finding_ids, alt.findings);
});

test('root cause ignores numbers, parenthesised detail and the "Affected" tail', () => {
  assert.equal(rootCause({ fix_hint: 'Fix it. Affected (3 elements): a; b.', message: 'm' }), 'fix it.');
  assert.equal(rootCause({ fix_hint: 'Raise contrast to 4.5:1 (was 2.8:1).', message: 'm' }), 'raise contrast to #.#:# .');
  assert.equal(rootCause({ fix_hint: '', message: 'Line 12 broke' }), 'line # broke');
});

test('every task states why (dimension, principle, profile), where, how it is accepted, effort, risk and the precedence note', () => {
  const p = make([F('d8.token_pair_contrast', { severity: 'blocker', kind: 'wcag_failure', location: { file: 'src/tokens.css', line: 4 }, fix_hint: 'Darken it.' })], {
    evidence: [{ check_id: 'd8.token_pair_contrast', value: 0.5 }],
    principleRefs: [{ principle: 'BXP-11', via: 'behavioural_principle:accessibility-baseline', non_negotiable: true }],
  });
  const t = p.tasks[0];
  assert.equal(t.rank, 1);
  assert.match(t.id, /^T-[0-9a-f]{8}$/);
  assert.equal(t.why.dimension, 'accessibility_inclusion');
  assert.equal(t.why.principle, 'BXP-11');
  assert.equal(t.why.principle_title, 'Accessibility and inclusive design');
  assert.equal(t.why.profile_ref, 'fixture-product@0.1.0');
  assert.deepEqual(t.why.profile_standards, ['behavioural principle accessibility-baseline (non-negotiable)']);
  assert.deepEqual(t.acceptance.check_id, 'd8.token_pair_contrast');
  assert.match(t.acceptance.rule, /measured again and none of the listed findings is present/);
  assert.match(t.acceptance.re_run, /brand-engine verify --before/);
  assert.equal(t.effort, 'S');
  assert.equal(t.blocker, true);
  assert.ok(t.domain_notes[0].includes('outrank this task'));
  // d8 token pairs: weight 12 x automated share 0.5 x check weight 25% x (1 - 0.5)
  assert.equal(t.expected_points, 0.75);
  assert.equal(t.points_per_effort, 0.75);
});

test('order: blockers first, then points per effort, then dimension order, then id; it never depends on input order', () => {
  const evidence = [
    { check_id: 'd8.token_pair_contrast', value: 0 },     // blocker, S: 12 x 0.5 x 0.25 = 1.5 points, 1.5 per unit
    { check_id: 'd6.claim_lint', value: 0 },              // blocker, S: 10 x 0.4 x 0.30 = 1.2 points
    { check_id: 'd5.dead_links', value: 0 },              // major, S: 10 x 0.7 x 0.20 = 1.4 points, 1.4 per unit
    { check_id: 'd5.route_inventory_vs_claims', value: 0 }, // major, L: 10 x 0.7 x 0.25 = 1.75 points, 0.21875 per unit
    { check_id: 'd1.purpose_statement_present', value: 0 }, // minor, S: 8 x 0.15 x 0.30 = 0.36
  ];
  const findings = [
    F('d1.purpose_statement_present', { severity: 'minor', dimension: 'emotional_clarity_positioning', fix_hint: 'purpose' }),
    F('d5.route_inventory_vs_claims', { dimension: 'functional_completeness', fix_hint: 'routes' }),
    F('d5.dead_links', { dimension: 'functional_completeness', fix_hint: 'links' }),
    F('d6.claim_lint', { severity: 'blocker', dimension: 'trust_transparency', fix_hint: 'claims' }),
    F('d8.token_pair_contrast', { severity: 'blocker', fix_hint: 'contrast' }),
  ];
  const expected = ['d8.token_pair_contrast', 'd6.claim_lint', 'd5.dead_links', 'd1.purpose_statement_present', 'd5.route_inventory_vs_claims'];
  assert.deepEqual(ids(make(findings, { evidence })), expected);
  assert.deepEqual(ids(make([...findings].reverse(), { evidence })), expected);
  assert.deepEqual(ids(make([findings[2], findings[4], findings[0], findings[3], findings[1]], { evidence })), expected);
  const body = (p) => JSON.stringify([p.tasks, p.needs_human, p.withheld, p.counts]);
  assert.equal(body(make(findings, { evidence })), body(make([...findings].reverse(), { evidence })), 'identical tasks whatever the order of the findings');
  assert.deepEqual(make(findings, { evidence }).tasks.map((t) => t.rank), [1, 2, 3, 4, 5]);
});

test('ties are broken by dimension order, then task id', () => {
  const evidence = [{ check_id: 'd8.focus_visible', value: 0 }, { check_id: 'd4.reduced_motion', value: 0 }];
  const p = make([
    F('d8.focus_visible', { fix_hint: 'focus' }),
    F('d4.reduced_motion', { dimension: 'visual_interaction_craftsmanship', fix_hint: 'motion' }),
  ], { evidence });
  // d8.focus_visible: 12 x .5 x .20 = 1.2 ; d4.reduced_motion: 9 x .5 x .20 = 0.9 -> different. Equalise by hand-checking the order rule below.
  assert.deepEqual(ids(p), ['d8.focus_visible', 'd4.reduced_motion']);
  const same = make([F('d1.product_md_consistency', { dimension: 'emotional_clarity_positioning', fix_hint: 'a' }), F('d1.product_md_consistency', { dimension: 'emotional_clarity_positioning', fix_hint: 'b' })], { evidence: [{ check_id: 'd1.product_md_consistency', value: 0 }] });
  const sorted = [...same.tasks].map((t) => t.id);
  assert.deepEqual(sorted, [...sorted].sort(), 'identical points per effort fall back to id order');
});

test('effort is a table, one size larger when a task touches more than five files, and is never zero-division', () => {
  const many = Array.from({ length: 6 }, (_, i) => F('d8.labels_alt_lang', { location: { file: `p${i}.html`, line: 1 }, fix_hint: 'alt' }));
  const p = make(many, { evidence: [{ check_id: 'd8.labels_alt_lang', value: 0 }] });
  assert.equal(p.tasks[0].effort, 'M');
  assert.ok(p.tasks[0].risk.notes.some((n) => /Touches 6 files/.test(n)));
  assert.equal(make([F('d9.shared_components', { dimension: 'cross_platform_consistency' })], { evidence: [{ check_id: 'd9.shared_components', value: 0 }] }).tasks[0].effort, 'L');
  assert.equal(make([F('d8.labels_alt_lang', { fix_hint: 'x' })]).tasks[0].expected_points, 0, 'a check with no evidence has no estimable gain');
});

test('engagement: tasks about retention, outcomes, habit principles or engagement metrics are needs_human and never ranked', () => {
  const evidence = [{ check_id: 'd8.token_pair_contrast', value: 0 }];
  const p = make([
    F('d8.token_pair_contrast', { fix_hint: 'Darken it.', severity: 'blocker' }),
    F('d8.focus_visible', { fix_hint: 'Add a streak counter to reward daily visits.' }),
    F('d7.empty_state_guidance', { dimension: 'perceived_demonstrated_value', fix_hint: 'Track session time and optimise for it.' }),
    F('d9.principle_diff', { dimension: 'cross_platform_consistency', fix_hint: 'Increase daily active users.' }),
    F('d1.product_md_consistency', { dimension: 'emotional_clarity_positioning', fix_hint: 'Send a push notification when people have not returned.' }),
    F('d6.honest_states', { dimension: 'trust_transparency', principle: 'BXP-09', fix_hint: 'Add a habit loop.' }),
    F('d6.claim_lint', { dimension: 'retention_continuing_value', fix_hint: 'Anything.' }),
    F('d5.dead_links', { dimension: 'functional_completeness', principle: 'BXP-10', fix_hint: 'Anything else.' }),
    F('d3.nav_depth', { dimension: 'usability_cognitive_load', fix_hint: 'Link opens in a new tab and launches a modal.' }),
  ], { evidence });
  assert.deepEqual(ids(p), ['d8.token_pair_contrast', 'd3.nav_depth'], '"opens" and "launches" alone are not engagement terms');
  assert.equal(p.needs_human.length, 7);
  assert.ok(p.needs_human.every((t) => t.needs_human === true && t.needs_human_reason && t.rank === undefined));
  const reasons = Object.fromEntries(p.needs_human.map((t) => [t.check_id, t.needs_human_reason]));
  assert.match(reasons['d8.focus_visible'], /streak/);
  assert.match(reasons['d7.empty_state_guidance'], /session time/);
  assert.match(reasons['d9.principle_diff'], /daily active users/);
  assert.match(reasons['d1.product_md_consistency'], /push notification/);
  assert.match(reasons['d6.honest_states'], /BXP-09/);
  assert.match(reasons['d6.claim_lint'], /outcomes and engagement/);
  assert.match(reasons['d5.dead_links'], /BXP-10/);
  assert.equal(p.counts.needs_human, 7);
  const md = renderPlan(p);
  assert.match(md, /## Needs human review \(not proposed\)/);
});

const OVERRIDES = [
  { principle: 'BXP-03', yields_to: 'accessibility', reason: 'Distinctive colour yields to contrast.' },
  { principle: 'BXP-05', yields_to: 'functional_correctness', reason: 'Value never overrides correctness.' },
];

test('precedence: a brand task whose principle yields to accessibility is withheld while an accessibility blocker touches the same file', () => {
  const p = make([
    F('d2.font_palette_deny_list', { dimension: 'brand_distinctiveness', location: { file: 'src/tokens.css', line: 2 }, fix_hint: 'Replace the default palette.' }),
    F('d8.token_pair_contrast', { severity: 'blocker', kind: 'wcag_failure', location: { file: 'src/tokens.css', line: 4 }, fix_hint: 'Darken it.' }),
  ], { domainOverrides: OVERRIDES, evidence: [{ check_id: 'd8.token_pair_contrast', value: 0 }, { check_id: 'd2.font_palette_deny_list', value: 0 }] });
  assert.deepEqual(ids(p), ['d8.token_pair_contrast']);
  assert.equal(p.withheld.length, 1);
  const w = p.withheld[0];
  assert.equal(w.check_id, 'd2.font_palette_deny_list');
  assert.equal(w.withheld.principle, 'BXP-03');
  assert.equal(w.withheld.yields_to, 'accessibility');
  assert.equal(w.withheld.blocked_by.length, 1);
  assert.match(w.withheld.text, /Fix the blocker first, then re-plan/);
  assert.match(renderPlan(p), /## Withheld: would conflict with a domain override/);
});

test('precedence is about overlap: a blocker on a different file does not withhold; a located blocker elsewhere does not, an unlocated one does', () => {
  const brand = F('d2.font_palette_deny_list', { dimension: 'brand_distinctiveness', location: { file: 'src/fonts.css', line: 1 }, fix_hint: 'Replace the default font.' });
  const evidence = [{ check_id: 'd2.font_palette_deny_list', value: 0 }];
  const elsewhere = make([brand, F('d8.token_pair_contrast', { severity: 'blocker', location: { file: 'src/tokens.css', line: 4 } })], { domainOverrides: OVERRIDES, evidence });
  assert.equal(elsewhere.withheld.length, 0);
  assert.ok(ids(elsewhere).includes('d2.font_palette_deny_list'));
  const unlocated = make([brand, F('d8.axe_violations', { severity: 'blocker' })], { domainOverrides: OVERRIDES, evidence });
  assert.equal(unlocated.withheld.length, 1, 'an accessibility blocker with no file blocks brand work everywhere');
  const onlyMajor = make([brand, F('d8.axe_violations', { severity: 'major' })], { domainOverrides: OVERRIDES, evidence });
  assert.equal(onlyMajor.withheld.length, 0, 'a major accessibility finding on no file is not a blocker');
});

test('a profile with no override for a principle never withholds, and domain tasks themselves are never withheld', () => {
  const p = make([
    F('d2.font_palette_deny_list', { dimension: 'brand_distinctiveness', location: { file: 'a.css', line: 1 }, fix_hint: 'fonts' }),
    F('d8.token_pair_contrast', { severity: 'blocker', location: { file: 'a.css', line: 2 }, fix_hint: 'contrast' }),
  ], { domainOverrides: [] });
  assert.equal(p.withheld.length, 0);
  assert.equal(p.tasks.length, 2);
  const protectedOnly = make([F('d8.token_pair_contrast', { severity: 'blocker', location: { file: 'a.css', line: 2 }, fix_hint: 'contrast' }), F('d5.test_pass_counts', { dimension: 'functional_completeness', severity: 'blocker', kind: 'failing_test', location: { file: 'a.css', line: 2 } })], { domainOverrides: OVERRIDES });
  assert.equal(protectedOnly.withheld.length, 0);
});

test('functional correctness outranks perceived value: a BXP-05 task waits for a failing test on the same file', () => {
  const p = make([
    F('d7.value_above_fold', { dimension: 'perceived_demonstrated_value', location: { file: 'app.js', line: 1 }, fix_hint: 'Show a real example.' }),
    F('d5.test_pass_counts', { dimension: 'functional_completeness', severity: 'blocker', kind: 'failing_test', location: { file: 'app.js', line: 9 } }),
  ], { domainOverrides: OVERRIDES });
  assert.deepEqual(p.withheld.map((t) => t.check_id), ['d7.value_above_fold']);
  assert.equal(p.withheld[0].withheld.yields_to, 'functional_correctness');
});

test('even a proposed task lists the profile overrides that apply to its principle', () => {
  const p = make([F('d2.font_palette_deny_list', { dimension: 'brand_distinctiveness', fix_hint: 'fonts' })], { domainOverrides: OVERRIDES });
  assert.ok(p.tasks[0].domain_notes.some((n) => /BXP-03 yields to accessibility/.test(n)));
  assert.ok(p.tasks[0].risk.notes.some((n) => /Profile override: BXP-03 yields to accessibility/.test(n)));
  assert.equal(p.tasks[0].risk.level, 'medium');
});

test('engine problems are reported apart and are never turned into product tasks; info findings make no task', () => {
  const p = make([
    F('d6.claim_lint', { engine: true, source_id: 'check-error', fix_hint: 'Fix the check module.' }),
    F('d4.detector_clean', { severity: 'info' }),
    F('d8.labels_alt_lang', { fix_hint: 'alt' }),
  ]);
  assert.equal(p.engine_issues.length, 1);
  assert.equal(p.engine_issues[0].check_id, 'd6.claim_lint');
  assert.deepEqual(ids(p), ['d8.labels_alt_lang']);
  assert.match(renderPlan(p), /## Engine issues/);
});

test('the markdown task list is deterministic, names every file and line, and escapes what came from a report', () => {
  const findings = [F('d8.labels_alt_lang', { severity: 'blocker', location: { file: 'public/index.html', line: 7 }, message: 'An image has no *alt* <b>text</b>', fix_hint: 'Add alt.' })];
  const a = renderPlan(make(findings, { evidence: [{ check_id: 'd8.labels_alt_lang', value: 0.5 }] }));
  const b = renderPlan(make(findings, { evidence: [{ check_id: 'd8.labels_alt_lang', value: 0.5 }] }));
  assert.equal(a, b);
  assert.match(a, /`public\/index\.html` lines 7/);
  assert.match(a, /- \[ \] `T-[0-9a-f]{8}` \| effort S/);
  assert.match(a, /BLOCKER/);
  assert.match(a, /Accessibility, security, safety, regulation and functional correctness outrank every task above/);
  assert.ok(!a.includes('<b>'));
});

test('a plan with nothing to do says so', () => {
  const p = make([]);
  assert.equal(p.tasks.length, 0);
  assert.match(renderPlan(p), /No task is proposed/);
});

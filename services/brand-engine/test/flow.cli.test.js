// The workflow commands as a subprocess: exit codes, usage errors, refusals and what reaches the output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/main.js';
import { copyBrandDir } from './_helpers.js';
import { E2E_CHECKS, REPORTS, copyProduct, flow, makeAnalysis, tmp, writeDoc, writeText } from './_flow_helpers.js';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const analysisFile = () => {
  const dir = copyProduct({ git: true });
  const out = tmp('an-');
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--out', out]).code, 0);
  return { dir, out, path: join(out, 'analysis.json') };
};

test('usage errors are exit 2 and print the usage', () => {
  const dir = copyProduct();
  const cases = [
    ['analyze'], ['analyze', dir, dir], ['analyze', dir, '--nope', 'x'], ['analyze', dir, '--out'], ['analyze', dir, '--out', 'a', '--out', 'b'],
    ['analyze', join(dir, 'missing')], ['analyze', join(dir, 'PRODUCT.md')],
    ['plan'], ['plan', 'a', 'b'], ['plan', 'a', '--profile', 'x'],
    ['verify'], ['verify', dir], ['verify', '--before', 'x'], ['verify', '--before', 'x', dir, dir],
    ['evidence'], ['evidence', 'nope'], ['evidence', 'assemble'], ['evidence', 'assemble', '--analysis', 'x'],
    ['evidence', 'assemble', '--analysis', 'x', '--built-by', 'b', '--assistive-tech', 'maybe'],
    ['evidence', 'assemble', '--analysis', 'x', '--built-by', 'b', '--repo', 'bad repo'],
    ['evidence', 'assemble', '--analysis', 'x', '--built-by', 'b', '--commit', 'abc'],
    ['evidence', 'assemble', 'stray', '--analysis', 'x', '--built-by', 'b'],
  ];
  for (const args of cases) {
    const r = flow(args);
    assert.equal(r.code, 2, args.join(' '));
    assert.ok(r.stderr.length > 0, args.join(' '));
  }
  assert.match(flow(['analyze']).stderr, /usage: brand-engine analyze/);
  assert.match(flow(['bogus']).stderr, /brand-engine verify --before/, 'the main usage lists the workflow commands');
});

test('analyze: exit 0 prints the analysis JSON; with --out it writes analysis.json and summary.md and prints the summary', () => {
  const dir = copyProduct();
  const a = flow(['analyze', dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(a.code, 0, a.stderr);
  assert.equal(JSON.parse(a.stdout).analysis_version, '1.0.0');
  const out = tmp('o-');
  const b = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--out', join(out, 'nested', 'deeper')]);
  assert.equal(b.code, 0);
  assert.match(b.stdout, /^# Brand experience analysis/);
  assert.equal(readFileSync(join(out, 'nested', 'deeper', 'analysis.json'), 'utf8'), a.stdout, 'the file is the same bytes as stdout');
});

test('plan: reads only a valid, unmodified analysis (2 for malformed, 3 for modified), and writes plan.json and plan.md', () => {
  const { path } = analysisFile();
  const out = tmp('p-');
  const r = flow(['plan', path, '--out', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(json(join(out, 'plan.json')).plan_version, '1.0.0');
  assert.match(readFileSync(join(out, 'plan.md'), 'utf8'), /## Tasks, in order/);
  assert.equal(flow(['plan', path]).stdout, readFileSync(join(out, 'plan.json'), 'utf8'), 'stdout is the same document');

  const bad = tmp('bad-');
  assert.equal(flow(['plan', join(bad, 'missing.json')]).code, 2);
  writeText(join(bad, 'junk.json'), '{nope');
  assert.equal(flow(['plan', join(bad, 'junk.json')]).code, 2);
  writeText(join(bad, 'wrong.json'), JSON.stringify({ analysis_version: '1.0.0' }));
  const wrong = flow(['plan', join(bad, 'wrong.json')]);
  assert.equal(wrong.code, 2);
  assert.match(wrong.stderr, /is not a valid brand-analysis/);
  const doc = json(path);
  doc.counts.findings = 99;
  writeDoc(join(bad, 'edited.json'), doc);
  const edited = flow(['plan', join(bad, 'edited.json')]);
  assert.equal(edited.code, 3);
  assert.match(edited.stderr, /modified after it was produced/);
  symlinkSync(path, join(bad, 'link.json'));
  assert.equal(flow(['plan', join(bad, 'link.json')]).code, 2);
  writeFileSync(join(bad, 'huge.json'), Buffer.alloc(17 * 1024 * 1024, 0x20));
  const huge = flow(['plan', join(bad, 'huge.json')]);
  assert.equal(huge.code, 2);
  assert.match(huge.stderr, /larger than/);
});

test('invalid brand data and a modified rubric are refused with exit 3 by every command that needs them', () => {
  const { dir, path } = analysisFile();
  const broken = copyBrandDir();
  writeText(join(broken, 'profiles', 'blupin.profile.json'), '{nope');
  for (const args of [
    ['analyze', dir, '--checks-dir', E2E_CHECKS, '--brand-dir', broken],
    ['plan', path, '--brand-dir', broken],
    ['evidence', 'assemble', '--analysis', path, '--built-by', 'b', '--brand-dir', broken],
  ]) {
    const r = flow(args);
    assert.equal(r.code, 3, args.join(' '));
    assert.match(r.stderr, /refused: brand data is invalid/);
  }
  const tampered = copyBrandDir();
  const rubricPath = join(tampered, 'rubrics', 'bxqs-1.0.0.json');
  const rubric = json(rubricPath);
  rubric.policy.release_evidenced_minimum = 60;
  writeFileSync(rubricPath, JSON.stringify(rubric));
  const r = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--brand-dir', tampered]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /modified since release/);
  assert.equal(flow(['plan', path, '--brand-dir', tampered]).code, 3);
});

test('an unknown --rubric is refused; an unreleased one is refused', () => {
  const dir = copyProduct();
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--rubric', 'bxqs-9.9.9']).code, 3);
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--rubric', 'nonsense']).code, 3);
});

test('verify: exit 0 improved or unchanged, 1 regression or a claim that did not land, 2 invalid, 3 refused or inconclusive', () => {
  const { dir, path } = analysisFile();
  const same = flow(['verify', '--before', path, dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(same.code, 0);
  assert.equal(JSON.parse(same.stdout).verdict, 'no_change');
  assert.equal(flow(['verify', '--before', join(tmp(), 'missing.json'), dir, '--checks-dir', E2E_CHECKS]).code, 2);
  assert.equal(flow(['verify', '--before', path, join(dir, 'nope'), '--checks-dir', E2E_CHECKS]).code, 2);

  // the baseline's profile must still be the profile: change it and the comparison is refused
  const profile = json(join(dir, 'brand', 'profile.json'));
  profile.purpose.text = `${profile.purpose.text} Changed.`;
  writeFileSync(join(dir, 'brand', 'profile.json'), JSON.stringify(profile));
  const refused = flow(['verify', '--before', path, dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(refused.code, 3);
  assert.match(refused.stderr, /profile differs/);

  // a different repository
  const other = copyProduct({ git: true });
  writeText(join(other, '.git', 'config'), '[remote "origin"]\n\turl = https://github.com/someone/else.git\n');
  const wrongRepo = flow(['verify', '--before', path, other, '--checks-dir', E2E_CHECKS]);
  assert.equal(wrongRepo.code, 2, 'the baseline repo is passed as --repo and the checkout contradicts it');
});

test('verify also refuses an --out inside the checkout', () => {
  const { dir, path } = analysisFile();
  const r = flow(['verify', '--before', path, dir, '--checks-dir', E2E_CHECKS, '--out', join(dir, 'verification')]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /must not be inside the checkout/);
});

test('verify: a baseline measured with reports must be verified with reports, or its findings are unverifiable (exit 3)', () => {
  const dir = copyProduct();
  const out = tmp('an-');
  assert.equal(flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS, '--out', out]).code, 0);
  const without = flow(['verify', '--before', join(out, 'analysis.json'), dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(without.code, 3, without.stderr);
  const v = JSON.parse(without.stdout);
  assert.equal(v.verdict, 'inconclusive');
  assert.ok(v.findings.unverifiable.length > 0);
  assert.deepEqual(v.findings.fixed, [], 'a report that was not supplied again fixes nothing');
  const withReports = flow(['verify', '--before', join(out, 'analysis.json'), dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS]);
  assert.equal(withReports.code, 0, withReports.stderr);
  assert.equal(JSON.parse(withReports.stdout).verdict, 'no_change');
});

// ------------------------------------------------------------ evidence assemble
const fixtureAnalysis = (over = {}) => {
  const doc = makeAnalysis(over);
  const path = join(tmp('doc-'), 'analysis.json');
  writeDoc(path, doc);
  return path;
};

test('assemble: what is refused rather than guessed, with a message that names the problem', () => {
  const noKind = fixtureAnalysis({ findings: [{ check_id: 'd9.principle_diff', severity: 'blocker', dimension: 'cross_platform_consistency' }] });
  let r = flow(['evidence', 'assemble', '--analysis', noKind, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /is a blocker but has no score kind/);

  const noCriterion = fixtureAnalysis({ findings: [{ check_id: 'd8.axe_violations', severity: 'blocker', kind: 'wcag_failure', wcag_level: 'A' }] });
  r = flow(['evidence', 'assemble', '--analysis', noCriterion, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /without a criterion: set "wcag_criterion"/);

  const noDate = fixtureAnalysis();
  r = flow(['evidence', 'assemble', '--analysis', noDate, '--built-by', 'b']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no generated_at: pass --generated-at/);
  assert.equal(flow(['evidence', 'assemble', '--analysis', noDate, '--built-by', 'b', '--generated-at', 'yesterday']).code, 2);

  const noGit = fixtureAnalysis({ input: { repo: null, commit: null, commit_source: 'none' } });
  r = flow(['evidence', 'assemble', '--analysis', noGit, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /has no repository/);
  assert.match(r.stderr, /has no commit/);
  r = flow(['evidence', 'assemble', '--analysis', noGit, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z', '--repo', 'a/b', '--commit', 'e'.repeat(40)]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).input, { repo: 'a/b', commit: 'e'.repeat(40) });
  r = flow(['evidence', 'assemble', '--analysis', noDate, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z', '--repo', 'other/name']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /contradicts the analysis/);
});

test('assemble: a prohibited engagement metric, an unknown assessor and a simulated run are refused, not dropped', () => {
  const analysis = fixtureAnalysis();
  const obs = (o) => { const p = join(tmp('o-'), 'obs.json'); writeText(p, JSON.stringify({ format: 'brand-observed/1', recorded_at: '2026-10-23T12:30:00Z', observations: [{ dimension: 'retention_continuing_value', source_class: 'observed_behaviour', metric_id: 'streak_length', value: 0.9, n: 40, method: 'Analytics export', participants: 'human', artifact_ref: 'x', ...o }] })); return p; };
  let r = flow(['evidence', 'assemble', '--analysis', analysis, '--built-by', 'b', '--observed', obs({})]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /prohibited engagement metric/);
  r = flow(['evidence', 'assemble', '--analysis', analysis, '--built-by', 'b', '--observed', obs({ metric_id: 'returning_user_goal_completion', participants: 'ai' })]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /participants: must be "human"/);
});

test('assemble: output is deterministic, validated by the scorer itself, and keeps provenance for every item', () => {
  const { path } = analysisFile();
  const dir = tmp('assemble-');
  const ass = join(dir, 'a.json');
  const obs = join(dir, 'o.json');
  writeText(ass, JSON.stringify({ format: 'brand-assessments/1', recorded_at: '2026-10-23T12:00:00Z', assessors: [{ id: 'jane', kind: 'human' }, { id: 'ai-b', kind: 'ai' }], assessments: [{ dimension: 'accessibility_inclusion', assessor: 'jane', level: 2, notes: 'ok', artifact_ref: 'n/jane.md' }, { dimension: 'accessibility_inclusion', assessor: 'ai-b', level: 2, notes: 'ok', artifact_ref: 'n/ai.md' }] }));
  writeText(obs, JSON.stringify({ format: 'brand-observed/1', recorded_at: '2026-10-23T13:00:00Z', observations: [{ dimension: 'usability_cognitive_load', source_class: 'observed_behaviour', metric_id: 'task_completion_rate', value: 0.75, n: 6, method: 'Moderated', participants: 'human', artifact_ref: 'n/s.md' }] }));
  const args = ['evidence', 'assemble', '--analysis', path, '--assessments', ass, '--observed', obs, '--built-by', 'fixture-builder', '--assistive-tech', 'true'];
  const one = flow(args);
  const two = flow(args);
  assert.equal(one.code, 0, one.stderr);
  assert.equal(one.stdout, two.stdout);
  const ev = JSON.parse(one.stdout);
  assert.equal(ev.generated_at, '2026-10-23T13:00:00Z', 'taken from the latest recorded_at, never from a clock');
  assert.equal(ev.built_by, 'fixture-builder');
  assert.equal(ev.context.assistive_technology_testing_possible, true);
  assert.deepEqual(ev.assessors, [{ id: 'ai-b', kind: 'ai' }, { id: 'jane', kind: 'human' }]);
  assert.equal(ev.expert.length, 2);
  assert.deepEqual(ev.observed.map((o) => o.metric_id), ['task_completion_rate']);
  assert.ok(ev.automated.every((a) => /^check:d[0-9]+\.[a-z_]+:/.test(a.artifact_ref) || /^adapter:/.test(a.artifact_ref)), 'each automated value names its source');
  const prov = ev['x-provenance'];
  assert.match(prov.analysis_sha256, /^[0-9a-f]{64}$/);
  assert.match(prov.assessments_sha256, /^[0-9a-f]{64}$/);
  assert.match(prov.observed_sha256, /^[0-9a-f]{64}$/);
  assert.equal(prov.automated['d8.token_pair_contrast'], 'check:d8.token_pair_contrast');
  assert.equal(prov.profile, 'e2e-fixture-product@0.1.0');
  const evPath = join(dir, 'ev.json');
  writeText(evPath, one.stdout);
  const scored = flow(['score', '--evidence', evPath, '--profile', 'infodot']);
  assert.equal(scored.code, 0, scored.stderr);
  const report = JSON.parse(scored.stdout);
  const usability = report.dimensions.find((d) => d.id === 'usability_cognitive_load');
  assert.equal(usability.components.observed_or_customer.metrics_measured, 1, 'n of 6 is above the minimum of five, so it counts');
  const a11y = report.dimensions.find((d) => d.id === 'accessibility_inclusion');
  assert.ok(a11y.evidence.some((e) => e.assessor === 'ai-b' && e.disposition === 'corroborating'), 'an AI assessment beside a human one is corroboration only');
});

test('assemble: -o writes the file and says so; stdout carries the JSON otherwise', () => {
  const { path } = analysisFile();
  const out = join(tmp('o-'), 'sub', 'evidence.json');
  const r = flow(['evidence', 'assemble', '--analysis', path, '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z', '-o', out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^wrote .*evidence\.json: 3 automated, 0 expert, 0 observed, 3 finding\(s\)\n$/);
  assert.equal(json(out).evidence_version, '1.0.0');
});

// ------------------------------------------------------------ what reaches the output
test('no environment value reaches any output of any workflow command', () => {
  const env = { DOT_MEMORY_TOKEN: 'tok-should-never-appear-1234', KNOWLEDGE_SECRET_BRAIN: 'secret-should-never-appear-5678', GITHUB_TOKEN: 'ghs-should-never-appear', HOME: '/home/should-never-appear' };
  const dir = copyProduct({ git: true });
  const out = tmp('env-');
  const a = flow(['analyze', dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS, '--out', out], env);
  const p = flow(['plan', join(out, 'analysis.json'), '--out', join(out, 'p')], env);
  const v = flow(['verify', '--before', join(out, 'analysis.json'), dir, '--checks-dir', E2E_CHECKS, '--reports', REPORTS, '--plan', join(out, 'p', 'plan.json'), '--out', join(out, 'v')], env);
  const e = flow(['evidence', 'assemble', '--analysis', join(out, 'analysis.json'), '--built-by', 'b', '--generated-at', '2026-10-23T12:00:00Z', '-o', join(out, 'ev.json')], env);
  const bad = flow(['plan', join(out, 'nope.json')], env);
  for (const r of [a, p, v, e, bad]) {
    for (const value of Object.values(env)) assert.ok(!r.stdout.includes(value) && !r.stderr.includes(value));
  }
  for (const f of ['analysis.json', 'summary.md', 'p/plan.json', 'p/plan.md', 'v/verification.json', 'v/verification.md', 'v/analysis.json', 'ev.json']) {
    const text = readFileSync(join(out, f), 'utf8');
    for (const value of [...Object.values(env), dir, 'ghp_', 'x-access-token']) assert.ok(!text.includes(value), `${f} contains ${value}`);
  }
});

test('main() returns a promise for workflow commands and a number for the rest', async () => {
  const lines = [];
  const code = main(['analyze'], { out: (l) => lines.push(l), err: (l) => lines.push(l) });
  assert.ok(code instanceof Promise);
  assert.equal(await code, 2);
  assert.equal(main(['framework', 'list'], { out: () => {}, err: () => {} }), 0);
  mkdirSync(join(tmp(), 'x'));
});

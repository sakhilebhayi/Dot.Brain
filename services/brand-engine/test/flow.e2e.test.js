// The whole workflow on the synthetic fixture product (test/fixtures/e2e): analyze -> plan ->
// (a scripted patch, standing in for whoever implements the plan) -> verify -> assemble -> score.
// Everything here is a TEST FIXTURE; no score below describes a real product.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_CHECKS, FAKE_COMMIT, checksum, copyProduct, flow, tmp, writeText } from './_flow_helpers.js';

const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const PROFILE = (dir) => join(dir, 'brand', 'profile.json');

const patchTokens = (dir) => writeFileSync(join(dir, 'src', 'tokens.css'), readFileSync(join(dir, 'src', 'tokens.css'), 'utf8').replace('#9a9a9a', '#595959'));
const patchAlt = (dir) => writeFileSync(join(dir, 'public', 'index.html'), readFileSync(join(dir, 'public', 'index.html'), 'utf8').replace('<img src="hero.png">', '<img src="hero.png" alt="A shop owner reviewing the ledger">'));
const patchClaim = (dir) => writeFileSync(join(dir, 'public', 'index.html'), readFileSync(join(dir, 'public', 'index.html'), 'utf8').replace('Trusted by 10,000 businesses.', 'Built for small shops.'));

const ASSESSMENTS = JSON.stringify({
  format: 'brand-assessments/1', recorded_at: '2026-10-23T12:00:00Z',
  assessors: [{ id: 'fixture-reviewer', kind: 'human' }],
  assessments: [{ dimension: 'accessibility_inclusion', assessor: 'fixture-reviewer', level: 2, notes: 'Fixture assessment: contrast and alt text fail on the entry page.', artifact_ref: 'notes/fixture-reviewer.md' }],
});

function stage(dir) {
  const work = tmp('e2e-');
  const run = (args, env) => flow(args, env);
  return {
    work,
    analyze: (out, extra = []) => run(['analyze', dir, '--checks-dir', E2E_CHECKS, '--out', out, ...extra]),
    plan: (analysis, out) => run(['plan', analysis, '--out', out]),
    verify: (before, planPath, out, extra = []) => run(['verify', '--before', before, dir, '--checks-dir', E2E_CHECKS, '--plan', planPath, '--out', out, ...extra]),
    evidence: (analysis, out) => {
      writeText(join(work, 'assessments.json'), ASSESSMENTS);
      return run(['evidence', 'assemble', '--analysis', analysis, '--assessments', join(work, 'assessments.json'), '--built-by', 'fixture-builder', '-o', out]);
    },
    score: (evidence) => run(['score', '--evidence', evidence, '--profile', PROFILE(dir)]),
  };
}

test('end to end: three seeded defects are found, planned, claimed falsely, fixed for real, verified and re-scored', () => {
  const dir = copyProduct({ git: true });
  const s = stage(dir);
  const before = checksum(dir);

  // ---- analyze
  const a1 = join(s.work, 'a1');
  let r = s.analyze(a1);
  assert.equal(r.code, 0, r.stderr);
  const analysis = json(join(a1, 'analysis.json'));
  assert.deepEqual(analysis.input, { repo: 'example/e2e-product', commit: FAKE_COMMIT, commit_source: 'git' });
  assert.deepEqual(analysis.findings.map((f) => f.check_id).sort(), ['d6.claim_lint', 'd8.labels_alt_lang', 'd8.token_pair_contrast']);
  assert.ok(analysis.findings.every((f) => f.severity === 'blocker'));
  const ev = Object.fromEntries(analysis.evidence.map((e) => [e.check_id, e.value]));
  assert.deepEqual(ev, { 'd6.claim_lint': 0.75, 'd8.labels_alt_lang': 0.5, 'd8.token_pair_contrast': 0.5 });
  const where = Object.fromEntries(analysis.findings.map((f) => [f.check_id, `${f.location.file}:${f.location.line}`]));
  assert.deepEqual(where, { 'd6.claim_lint': 'public/index.html:6', 'd8.labels_alt_lang': 'public/index.html:7', 'd8.token_pair_contrast': 'src/tokens.css:4' });
  assert.match(readFileSync(join(a1, 'summary.md'), 'utf8'), /# Brand experience analysis/);

  // ---- plan
  const p1 = join(s.work, 'p1');
  r = s.plan(join(a1, 'analysis.json'), p1);
  assert.equal(r.code, 0, r.stderr);
  const plan = json(join(p1, 'plan.json'));
  assert.equal(plan.tasks.length, 3);
  assert.deepEqual(plan.tasks.map((t) => t.rank), [1, 2, 3]);
  assert.ok(plan.tasks.every((t) => t.blocker && t.effort === 'S' && t.acceptance.finding_ids.length === 1));
  assert.equal(plan.tasks[2].check_id, 'd6.claim_lint', 'the lowest points per effort goes last');
  assert.deepEqual(plan.needs_human, []);
  assert.deepEqual(plan.withheld, []);
  const md = readFileSync(join(p1, 'plan.md'), 'utf8');
  for (const needle of ['`src/tokens.css` lines 4', '`public/index.html` lines 6', '`public/index.html` lines 7', 'BXP-11', 'BXP-04', '- [ ]']) assert.ok(md.includes(needle), needle);

  // ---- score the "before" state
  const e1 = join(s.work, 'e1.json');
  r = s.evidence(join(a1, 'analysis.json'), e1);
  assert.equal(r.code, 0, r.stderr);
  r = s.score(e1);
  assert.equal(r.code, 0, r.stderr);
  const scoreBefore = JSON.parse(r.stdout);
  assert.equal(scoreBefore.state, 'not_ready');
  assert.deepEqual(scoreBefore.blockers.map((b) => b.kind).sort(), ['unsupported_claim', 'wcag_failure', 'wcag_failure']);
  assert.ok(scoreBefore.header.input.commit === FAKE_COMMIT && scoreBefore.header.input.repo === 'example/e2e-product');

  // ---- a claim of "done" with nothing changed is not believed
  r = s.verify(join(a1, 'analysis.json'), join(p1, 'plan.json'), join(s.work, 'v0'), ['--claimed', 'all']);
  assert.equal(r.code, 1, r.stderr);
  const v0 = json(join(s.work, 'v0', 'verification.json'));
  assert.equal(v0.verdict, 'claims_not_landed');
  assert.deepEqual(v0.tasks.map((t) => t.outcome), ['claimed_not_landed', 'claimed_not_landed', 'claimed_not_landed']);
  assert.deepEqual(v0.findings.fixed, []);
  assert.equal(v0.findings.still_open.length, 3);
  assert.match(readFileSync(join(s.work, 'v0', 'verification.md'), 'utf8'), /claimed not landed \(claimed\)/);

  // ---- the engine has not touched the product
  assert.equal(checksum(dir), before, 'analyze, plan, assemble, score and verify are read-only over the checkout');

  // ---- a partial fix: only the alt text lands, but all three tasks are claimed
  patchAlt(dir);
  r = s.verify(join(a1, 'analysis.json'), join(p1, 'plan.json'), join(s.work, 'v1'), ['--claimed', 'all']);
  assert.equal(r.code, 1);
  const v1 = json(join(s.work, 'v1', 'verification.json'));
  assert.equal(v1.verdict, 'claims_not_landed');
  const out1 = Object.fromEntries(v1.tasks.map((t) => [t.check_id, t.outcome]));
  assert.deepEqual(out1, { 'd8.labels_alt_lang': 'landed', 'd8.token_pair_contrast': 'claimed_not_landed', 'd6.claim_lint': 'claimed_not_landed' });
  assert.equal(v1.findings.fixed.length, 1);

  // ---- the real fix
  patchTokens(dir);
  patchClaim(dir);
  r = s.verify(join(a1, 'analysis.json'), join(p1, 'plan.json'), join(s.work, 'v2'), ['--claimed', 'all']);
  assert.equal(r.code, 0, r.stderr);
  const v2 = json(join(s.work, 'v2', 'verification.json'));
  assert.equal(v2.verdict, 'improved');
  assert.deepEqual(v2.tasks.map((t) => t.outcome), ['landed', 'landed', 'landed']);
  assert.equal(v2.findings.fixed.length, 3);
  assert.equal(v2.findings.new.length, 0);
  assert.deepEqual(v2.checks.map((c) => [c.check_id, c.before, c.after]), [['d6.claim_lint', 0.75, 1], ['d8.labels_alt_lang', 0.5, 1], ['d8.token_pair_contrast', 0.5, 1]]);

  // ---- score the "after" state from the analysis verify wrote, and compare
  const a2 = join(s.work, 'v2', 'analysis.json');
  const e2 = join(s.work, 'e2.json');
  assert.equal(s.evidence(a2, e2).code, 0);
  r = s.score(e2);
  assert.equal(r.code, 0, r.stderr);
  const scoreAfter = JSON.parse(r.stdout);
  assert.deepEqual(scoreAfter.blockers, []);
  assert.ok(scoreAfter.headline.evidenced_score > scoreBefore.headline.evidenced_score);
  assert.notEqual(scoreAfter.state, 'release_ready', 'three automated checks and one assessment do not make a release');
  writeFileSync(join(s.work, 'before.report.json'), JSON.stringify(scoreBefore));
  writeFileSync(join(s.work, 'after.report.json'), JSON.stringify(scoreAfter));
  r = flow(['compare', join(s.work, 'before.report.json'), join(s.work, 'after.report.json')]);
  assert.equal(r.code, 0, r.stderr);
});

test('a regression introduced while fixing something else is reported and fails verify', () => {
  const dir = copyProduct({ git: true });
  const s = stage(dir);
  const a1 = join(s.work, 'a1');
  assert.equal(s.analyze(a1).code, 0);
  assert.equal(s.plan(join(a1, 'analysis.json'), join(s.work, 'p1')).code, 0);
  patchAlt(dir);
  patchTokens(dir);
  patchClaim(dir);
  writeFileSync(join(dir, 'public', 'index.html'), readFileSync(join(dir, 'public', 'index.html'), 'utf8').replace('</body>', '<img src="extra.png">\n</body>'));
  const r = s.verify(join(a1, 'analysis.json'), join(s.work, 'p1', 'plan.json'), join(s.work, 'v1'), ['--claimed', 'all']);
  assert.equal(r.code, 1);
  const v = json(join(s.work, 'v1', 'verification.json'));
  assert.equal(v.verdict, 'regressed');
  assert.equal(v.findings.new.length, 1);
  assert.equal(v.findings.new[0].check_id, 'd8.labels_alt_lang');
  assert.equal(v.findings.fixed.length, 3, 'the three original defects are fixed, and the regression is still reported');
  assert.match(r.stdout, /Verdict: \*\*regressed\*\*/);
});

test('verify with no change at all is "no change" and exits 0; a different baseline for the same product still verifies', () => {
  const dir = copyProduct({ git: true });
  const s = stage(dir);
  const a1 = join(s.work, 'a1');
  assert.equal(s.analyze(a1).code, 0);
  const r = flow(['verify', '--before', join(a1, 'analysis.json'), dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(r.code, 0, r.stderr);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'no_change');
  assert.equal(v.findings.still_open.length, 3);
});

test('verify refuses a baseline that was edited by hand to fake a result', () => {
  const dir = copyProduct({ git: true });
  const s = stage(dir);
  const a1 = join(s.work, 'a1');
  assert.equal(s.analyze(a1).code, 0);
  const doc = json(join(a1, 'analysis.json'));
  doc.findings = [];
  writeText(join(s.work, 'edited.json'), JSON.stringify(doc));
  const r = flow(['verify', '--before', join(s.work, 'edited.json'), dir, '--checks-dir', E2E_CHECKS]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /modified after it was produced/);
  const p = flow(['plan', join(s.work, 'edited.json')]);
  assert.equal(p.code, 3);
});

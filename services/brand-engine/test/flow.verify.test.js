// verify: the diff of two analyses, and a verdict that never claims an improvement it did not measure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { plan } from '../src/analyze/plan.js';
import { assertComparable, VerifyRefused, verify } from '../src/analyze/verify.js';
import { renderVerification } from '../src/analyze/render.js';
import { BUNDLE, REG, makeAnalysis, seal } from './_flow_helpers.js';

const fp = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const F = (check_id, tag, extra = {}) => ({ check_id, severity: 'major', fingerprint: fp(`${check_id}${tag}`), message: `${check_id} ${tag}`, fix_hint: `fix ${check_id}`, ...extra });
const E = (check_id, value) => ({ check_id, value });
const ctx = { rubric: BUNDLE.rubric, principles: REG.principles };
const run = (before, after, opts) => verify(before, after, opts);
const idsOf = (list) => list.map((f) => f.id);

const A = F('d8.labels_alt_lang', 'a');
const B = F('d8.labels_alt_lang', 'b');
const C = F('d6.claim_lint', 'c', { dimension: 'trust_transparency', severity: 'blocker' });

test('fixed, still open and new are separated by finding id, and only measured checks can fix', () => {
  const before = makeAnalysis({ findings: [A, B, C], evidence: [E('d8.labels_alt_lang', 0.5), E('d6.claim_lint', 0.5)] });
  const D = F('d8.labels_alt_lang', 'd');
  const after = makeAnalysis({ findings: [B, D], evidence: [E('d8.labels_alt_lang', 0.75), E('d6.claim_lint', 1)] });
  const r = run(before, after);
  assert.deepEqual(idsOf(r.findings.fixed).sort(), idsOf([A, C].map((f) => ({ id: `${f.check_id}.${f.fingerprint}` }))).sort());
  assert.deepEqual(idsOf(r.findings.still_open), [`d8.labels_alt_lang.${B.fingerprint}`]);
  assert.deepEqual(idsOf(r.findings.new), [`d8.labels_alt_lang.${D.fingerprint}`]);
  assert.equal(r.verdict, 'regressed', 'a new finding is a regression even when others were fixed');
  assert.equal(r.exit, 1);
  assert.deepEqual(r.counts, { fixed: 2, still_open: 1, new: 1, newly_measured: 0, unverifiable: 0, tasks_landed: 0, claimed_not_landed: 0 });
});

test('improved: findings fixed and the check measured again with a higher value, exit 0', () => {
  const before = makeAnalysis({ findings: [A, B], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const after = makeAnalysis({ findings: [B], evidence: [E('d8.labels_alt_lang', 0.75)] });
  const r = run(before, after);
  assert.equal(r.verdict, 'improved');
  assert.equal(r.exit, 0);
  assert.deepEqual(r.checks, [{ check_id: 'd8.labels_alt_lang', status: 'improved', before: 0.5, after: 0.75, delta: 0.25 }]);
  assert.match(r.reasons.join(' '), /1 finding\(s\) fixed and measured as fixed/);
});

test('no change: identical measurements are no change, exit 0 (still-open findings do not make it a failure)', () => {
  const before = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const after = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const r = run(before, after);
  assert.equal(r.verdict, 'no_change');
  assert.equal(r.exit, 0);
  assert.equal(r.findings.still_open.length, 1);
});

test('a finding that stops appearing because its check is no longer measured is unverifiable, never fixed', () => {
  const before = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const after = makeAnalysis({ findings: [], evidence: [] });
  const r = run(before, after);
  assert.deepEqual(r.findings.fixed, []);
  assert.equal(r.findings.unverifiable.length, 1);
  assert.match(r.findings.unverifiable[0].reason, /no longer measured/);
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.exit, 3);
  assert.equal(r.checks[0].status, 'no_longer_measured');
});

test('unverifiable findings do not erase a measured improvement elsewhere', () => {
  const before = makeAnalysis({ findings: [A, C], evidence: [E('d8.labels_alt_lang', 0.5), E('d6.claim_lint', 0.5)] });
  const after = makeAnalysis({ findings: [], evidence: [E('d6.claim_lint', 1)] });
  const r = run(before, after);
  assert.equal(r.verdict, 'improved');
  assert.equal(r.findings.unverifiable.length > 0, true);
  assert.deepEqual(idsOf(r.findings.fixed), [`d6.claim_lint.${C.fingerprint}`]);
});

test('a check that was not measured before is "newly measured": its findings are information, not regressions', () => {
  const before = makeAnalysis({ findings: [], evidence: [E('d8.labels_alt_lang', 1)] });
  const after = makeAnalysis({ findings: [C], evidence: [E('d8.labels_alt_lang', 1), E('d6.claim_lint', 0.5)] });
  const r = run(before, after);
  assert.equal(r.findings.new.length, 0);
  assert.equal(r.findings.newly_measured.length, 1);
  assert.equal(r.verdict, 'no_change', 'newly measured is information: it is neither an improvement nor a regression');
  assert.match(r.reasons.join(' '), /1 finding\(s\) come from checks that were not measured in the baseline/);
});

test('a measured value that got worse is a regression even with no new finding', () => {
  const before = makeAnalysis({ findings: [], evidence: [E('d8.labels_alt_lang', 0.9)] });
  const after = makeAnalysis({ findings: [], evidence: [E('d8.labels_alt_lang', 0.6)] });
  const r = run(before, after);
  assert.equal(r.verdict, 'regressed');
  assert.deepEqual(r.checks[0].status, 'regressed');
  assert.equal(r.exit, 1);
});

test('engine findings (a check that errored) are never product findings in the diff', () => {
  const before = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const after = makeAnalysis({ findings: [A, F('d6.claim_lint', 'boom', { engine: true })], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const r = run(before, after);
  assert.equal(r.findings.new.length, 0);
  assert.equal(r.verdict, 'no_change');
});

// ------------------------------------------------------------ plan tasks and claims
function planned() {
  const before = makeAnalysis({ findings: [A, C], evidence: [E('d8.labels_alt_lang', 0.5), E('d6.claim_lint', 0.5)] });
  const p = plan(before, ctx);
  const task = (check) => p.tasks.find((t) => t.check_id === check);
  return { before, p, alt: task('d8.labels_alt_lang'), claim: task('d6.claim_lint') };
}

test('a claimed task whose findings are still present is "claimed but not landed" and the verdict is not an improvement', () => {
  const { before, p, alt, claim } = planned();
  const after = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5), E('d6.claim_lint', 1)] });
  const r = run(before, after, { plan: p, claimed: new Set([alt.id, claim.id]) });
  const by = Object.fromEntries(r.tasks.map((t) => [t.id, t]));
  assert.equal(by[alt.id].outcome, 'claimed_not_landed');
  assert.deepEqual(by[alt.id].remaining_findings, alt.findings);
  assert.equal(by[claim.id].outcome, 'landed');
  assert.equal(r.verdict, 'claims_not_landed');
  assert.equal(r.exit, 1);
  assert.match(r.reasons.join(' '), /1 claimed task\(s\) not landed/);
  assert.match(renderVerification(r), /claimed not landed \(claimed\)/);
});

test('an unclaimed task that has not landed is just open; a landed one is landed; --claimed all claims every task', () => {
  const { before, p, alt, claim } = planned();
  const after = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5), E('d6.claim_lint', 1)] });
  const r = run(before, after, { plan: p });
  const by = Object.fromEntries(r.tasks.map((t) => [t.id, t]));
  assert.equal(by[alt.id].outcome, 'open');
  assert.equal(by[claim.id].outcome, 'landed');
  assert.equal(r.verdict, 'improved');
  const all = run(before, after, { plan: p, claimAll: true });
  assert.equal(all.verdict, 'claims_not_landed');
});

test('a claimed task whose check is no longer measured cannot be verified: inconclusive, never landed', () => {
  const { before, p, alt } = planned();
  const after = makeAnalysis({ findings: [], evidence: [E('d6.claim_lint', 1)] });
  const r = run(before, after, { plan: p, claimed: new Set([alt.id]) });
  assert.equal(r.tasks.find((t) => t.id === alt.id).outcome, 'claimed_unverifiable');
  assert.equal(r.verdict, 'inconclusive');
  assert.equal(r.exit, 3);
});

test('a task is landed only when none of ITS findings remain, even if the check has other findings', () => {
  const { before, p, alt } = planned();
  const other = F('d8.labels_alt_lang', 'other', { fix_hint: 'a different fix' });
  const after = makeAnalysis({ findings: [other], evidence: [E('d8.labels_alt_lang', 0.75), E('d6.claim_lint', 1)] });
  const r = run(before, after, { plan: p, claimed: new Set([alt.id]) });
  assert.equal(r.tasks.find((t) => t.id === alt.id).outcome, 'landed');
  assert.equal(r.findings.new.length, 1);
  assert.equal(r.verdict, 'regressed');
});

test('--claimed naming a task that is not in the plan is refused', () => {
  const { before, p } = planned();
  const after = makeAnalysis({ findings: [], evidence: [] });
  assert.throws(() => run(before, after, { plan: p, claimed: new Set(['T-deadbeef']) }), VerifyRefused);
});

// ------------------------------------------------------------ refusals
test('the engine refuses to compare what cannot honestly be compared', () => {
  const base = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const ok = makeAnalysis({ findings: [A], evidence: [E('d8.labels_alt_lang', 0.5)] });
  assert.doesNotThrow(() => assertComparable(base, ok));

  const tampered = structuredClone(base);
  tampered.findings = [];
  assert.throws(() => assertComparable(tampered, ok), /modified after it was produced/);

  const otherRubric = makeAnalysis({ rubric: { id: 'bxqs', version: '1.1.0', sha256: 'b'.repeat(64) } });
  assert.throws(() => assertComparable(base, otherRubric), /rubric differs/);
  const sameVersionOtherHash = makeAnalysis({ rubric: { id: 'bxqs', version: '1.0.0', sha256: 'c'.repeat(64) } });
  assert.throws(() => assertComparable(base, sameVersionOtherHash), /rubric differs/);

  const otherProfile = makeAnalysis({ profile: { sha256: 'd'.repeat(64) } });
  assert.throws(() => assertComparable(base, otherProfile), /profile differs/);
  const otherProfileVersion = makeAnalysis({ profile: { version: '0.2.0' } });
  assert.throws(() => assertComparable(base, otherProfileVersion), /profile differs/);

  const otherRepo = makeAnalysis({ input: { repo: 'someone/else' } });
  assert.throws(() => assertComparable(base, otherRepo), /baseline is for example\/fixture, this checkout is someone\/else/);
  const noRepo = makeAnalysis({ input: { repo: null, commit: null, commit_source: 'none' } });
  assert.doesNotThrow(() => assertComparable(base, noRepo), 'an unknown repository is not a contradiction');

  const major = seal({ ...structuredClone(ok), analysis_version: '2.0.0', integrity: undefined });
  assert.throws(() => assertComparable(base, major), /different major versions/);

  const p = plan(base, ctx);
  const otherAnalysis = makeAnalysis({ findings: [B], evidence: [E('d8.labels_alt_lang', 0.5)] });
  assert.throws(() => assertComparable(otherAnalysis, ok, p), /different analysis than --before/);
  const tamperedPlan = structuredClone(p);
  tamperedPlan.tasks[0].effort = 'S';
  tamperedPlan.tasks[0].title = 'x';
  assert.throws(() => assertComparable(base, ok, tamperedPlan), /--plan: .*modified/);
});

test('the verification is deterministic and carries its own integrity hash', () => {
  const before = makeAnalysis({ findings: [A, B], evidence: [E('d8.labels_alt_lang', 0.5)] });
  const after = makeAnalysis({ findings: [B], evidence: [E('d8.labels_alt_lang', 0.75)] });
  const one = run(before, after);
  const two = run(structuredClone(before), structuredClone(after));
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.match(one.integrity.sha256, /^[0-9a-f]{64}$/);
  assert.equal(renderVerification(one), renderVerification(two));
});

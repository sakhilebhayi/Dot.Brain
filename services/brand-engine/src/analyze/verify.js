// services/brand-engine/src/analyze/verify.js
//
// verify(before, after, {plan, claimed}) -> a diff of two analyses of the same
// product, and a verdict that never claims an improvement it did not measure.
//
//   fixed          in `before`, absent from `after`, and its check WAS measured
//                  in `after` (a finding that merely stopped being looked for is
//                  not fixed: it is `unverifiable`)
//   still_open     in both
//   new            absent from `before`, present in `after`, and its check was
//                  measured in both (a regression). A finding from a check that
//                  was not measured before is `newly_measured`, information only
//   unverifiable   the check that raised it is no longer measured
// and, per plan task, whether its acceptance now passes (the check is measured
// and none of the task's findings remain). A task someone CLAIMS is done whose
// acceptance still fails is reported as `claimed_not_landed`.
//
// verdict (precedence, highest first) and exit code:
//   regressed          a new finding, or a measured check that got worse     1
//   claims_not_landed  a claimed task whose acceptance still fails           1
//   inconclusive       nothing measured improved and something could not be
//                      measured, or a claimed task cannot be verified         3
//   improved           a measured finding fixed or a measured value up        0
//   no_change          nothing differs and nothing is unverifiable            0
import { ENGINE_VERSION } from '../score/constants.js';
import { canonicalHash } from '../score/util.js';
import { integrityProblems } from './analyze.js';
import { byText } from './text.js';

export const VERIFY_VERSION = '1.0.0';
export const VERIFY_EXIT = { OK: 0, REGRESSED: 1, INVALID: 2, REFUSED: 3 };
const EPS = 1e-9;

export class VerifyRefused extends Error {
  constructor(message) { super(message); this.name = 'VerifyRefused'; }
}

/** Throws VerifyRefused when the two analyses cannot honestly be compared. */
export function assertComparable(before, after, plan) {
  const bad = integrityProblems(before);
  if (bad.length) throw new VerifyRefused(`--before: ${bad[0]}`);
  if (before.analysis_version.split('.')[0] !== after.analysis_version.split('.')[0]) throw new VerifyRefused('the two analyses have different major versions');
  if (before.rubric.id !== after.rubric.id || before.rubric.version !== after.rubric.version || before.rubric.sha256 !== after.rubric.sha256) {
    throw new VerifyRefused(`the rubric differs (${before.rubric.id}@${before.rubric.version} vs ${after.rubric.id}@${after.rubric.version}, or its hash): differences would be methodology, not the product`);
  }
  if (before.profile.id !== after.profile.id || before.profile.version !== after.profile.version || before.profile.sha256 !== after.profile.sha256) {
    throw new VerifyRefused('the profile differs from the one the baseline used; re-run analyze for a new baseline instead of comparing across profiles');
  }
  if (before.input.repo && after.input.repo && before.input.repo !== after.input.repo) {
    throw new VerifyRefused(`the baseline is for ${before.input.repo}, this checkout is ${after.input.repo}`);
  }
  if (plan) {
    const pb = integrityProblems(plan);
    if (pb.length) throw new VerifyRefused(`--plan: ${pb[0]}`);
    if (plan.source.analysis_sha256 !== before.integrity.sha256) throw new VerifyRefused('the plan was made from a different analysis than --before');
  }
}

export function verify(before, after, { plan, claimed = new Set(), claimAll = false } = {}) {
  assertComparable(before, after, plan);
  const bEvidence = new Map(before.evidence.map((e) => [e.check_id, e]));
  const aEvidence = new Map(after.evidence.map((e) => [e.check_id, e]));
  const measuredBefore = (c) => bEvidence.has(c);
  const measuredAfter = (c) => aEvidence.has(c);
  const product = (doc) => doc.findings.filter((f) => !f.engine);
  const bf = new Map(product(before).map((f) => [f.id, f]));
  const af = new Map(product(after).map((f) => [f.id, f]));
  const brief = (f) => ({ id: f.id, check_id: f.check_id, severity: f.severity, message: f.message, ...(f.location ? { location: f.location } : {}) });

  const fixed = [];
  const stillOpen = [];
  const unverifiable = [];
  const added = [];
  const newlyMeasured = [];
  for (const [id, f] of [...bf].sort(([a], [b]) => byText(a, b))) {
    if (af.has(id)) stillOpen.push(brief(f));
    else if (measuredAfter(f.check_id)) fixed.push(brief(f));
    else unverifiable.push({ ...brief(f), reason: measuredBefore(f.check_id) ? 'the check is no longer measured' : 'the check was never measured with evidence' });
  }
  for (const [id, f] of [...af].sort(([a], [b]) => byText(a, b))) {
    if (bf.has(id)) continue;
    if (measuredBefore(f.check_id)) added.push(brief(f));
    else newlyMeasured.push(brief(f));
  }

  const checkIds = [...new Set([...bEvidence.keys(), ...aEvidence.keys()])].sort(byText);
  const checks = checkIds.map((id) => {
    const b = bEvidence.get(id);
    const a = aEvidence.get(id);
    let status;
    if (b && !a) status = 'no_longer_measured';
    else if (!b && a) status = 'newly_measured';
    else if (a.value - b.value > EPS) status = 'improved';
    else if (b.value - a.value > EPS) status = 'regressed';
    else status = 'same';
    return { check_id: id, status, before: b ? b.value : null, after: a ? a.value : null, delta: b && a ? Math.round((a.value - b.value) * 1e9) / 1e9 : null };
  });
  for (const c of checks) {
    if (c.status === 'no_longer_measured' && !unverifiable.some((u) => u.check_id === c.check_id)) {
      unverifiable.push({ id: `check:${c.check_id}`, check_id: c.check_id, severity: 'info', message: `${c.check_id} was measured before and is not measured now`, reason: 'the check is no longer measured' });
    }
  }

  const taskResults = [];
  if (plan) {
    for (const t of plan.tasks) {
      const isClaimed = claimAll || claimed.has(t.id);
      const measured = measuredAfter(t.acceptance.check_id);
      const remaining = t.acceptance.finding_ids.filter((id) => af.has(id));
      let acceptance;
      if (!measured) acceptance = 'unverifiable';
      else acceptance = remaining.length === 0 ? 'passes' : 'fails';
      let outcome;
      if (acceptance === 'passes') outcome = 'landed';
      else if (acceptance === 'unverifiable') outcome = isClaimed ? 'claimed_unverifiable' : 'unverifiable';
      else outcome = isClaimed ? 'claimed_not_landed' : 'open';
      taskResults.push({
        id: t.id, title: t.title, check_id: t.acceptance.check_id, claimed: isClaimed, acceptance, outcome,
        remaining_findings: remaining,
      });
    }
    taskResults.sort((x, y) => byText(x.id, y.id));
  }
  for (const c of claimed) if (plan && !plan.tasks.some((t) => t.id === c)) throw new VerifyRefused(`--claimed names ${c}, which is not a task in the plan`);

  const regressions = [
    ...added.map((f) => ({ kind: 'new_finding', ref: f.id })),
    ...checks.filter((c) => c.status === 'regressed').map((c) => ({ kind: 'check_value_dropped', ref: c.check_id })),
  ];
  const claimsNotLanded = taskResults.filter((t) => t.outcome === 'claimed_not_landed');
  const claimsUnverifiable = taskResults.filter((t) => t.outcome === 'claimed_unverifiable');
  const improved = fixed.length > 0 || checks.some((c) => c.status === 'improved');

  let verdict;
  if (regressions.length) verdict = 'regressed';
  else if (claimsNotLanded.length) verdict = 'claims_not_landed';
  else if (claimsUnverifiable.length || (unverifiable.length && !improved)) verdict = 'inconclusive';
  else if (improved) verdict = 'improved';
  else verdict = 'no_change';
  const exit = verdict === 'regressed' || verdict === 'claims_not_landed' ? VERIFY_EXIT.REGRESSED : verdict === 'inconclusive' ? VERIFY_EXIT.REFUSED : VERIFY_EXIT.OK;

  const reasons = [];
  if (regressions.length) reasons.push(`${regressions.length} regression(s): ${added.length} new finding(s), ${regressions.length - added.length} measured value(s) lower.`);
  if (claimsNotLanded.length) reasons.push(`${claimsNotLanded.length} claimed task(s) not landed: ${claimsNotLanded.map((t) => t.id).join(', ')}.`);
  if (claimsUnverifiable.length) reasons.push(`${claimsUnverifiable.length} claimed task(s) cannot be verified because their check is not measured: ${claimsUnverifiable.map((t) => t.id).join(', ')}.`);
  if (unverifiable.length) reasons.push(`${unverifiable.length} earlier finding(s) cannot be verified because their check is no longer measured; they are neither fixed nor open.`);
  if (verdict === 'improved') reasons.push(`${fixed.length} finding(s) fixed and measured as fixed; ${checks.filter((c) => c.status === 'improved').length} check value(s) higher.`);
  if (verdict === 'no_change') reasons.push('Nothing measured differs from the baseline.');
  if (newlyMeasured.length) reasons.push(`${newlyMeasured.length} finding(s) come from checks that were not measured in the baseline; they are not counted as regressions.`);

  const doc = {
    verify_version: VERIFY_VERSION,
    engine_version: ENGINE_VERSION,
    before: { analysis_sha256: before.integrity.sha256, commit: before.input.commit },
    after: { analysis_sha256: after.integrity.sha256, commit: after.input.commit },
    verdict,
    exit,
    reasons,
    findings: { fixed, still_open: stillOpen, new: added, newly_measured: newlyMeasured, unverifiable },
    checks,
    tasks: taskResults,
    counts: {
      fixed: fixed.length, still_open: stillOpen.length, new: added.length, newly_measured: newlyMeasured.length, unverifiable: unverifiable.length,
      tasks_landed: taskResults.filter((t) => t.outcome === 'landed').length, claimed_not_landed: claimsNotLanded.length,
    },
  };
  doc.integrity = { sha256: canonicalHash(doc) };
  return doc;
}

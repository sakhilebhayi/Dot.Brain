import { forCheck } from './runbooks.js';

/**
 * The guardian decision engine -- a PURE function so every rule branch is
 * unit-testable. Given one incident plus its context, decide what the
 * guardian may do:
 *
 *   observe         -- record only (autonomy level 1, or nothing to do)
 *   recommend       -- publish a diagnosis + proposed action for humans
 *                      (autonomy level 2, or gates not met at level 3+)
 *   auto_remediate  -- execute the matched runbook through CI/CD
 *   escalate        -- stop and demand a human (breaker open, attempts
 *                      exhausted, or infrastructure down)
 *
 * Confidence comes from Dot.Memory recall (has this signature been fixed
 * before, and did the fix stick?); risk comes from the runbook itself.
 * Autonomous action requires level >= 3 AND confidence >= 0.6 AND
 * risk <= 0.4 AND the deploy budget not exhausted.
 */
export function evaluate({ incident, manifest, recall = { matches: 0 }, breakerOpen = false, deploysLast6h = 0 }) {
  const reasons = [];
  const runbook = forCheck(incident.check_key);

  if (breakerOpen) {
    return decision('escalate', null, 0, 1, ['circuit breaker is open for this platform; human reset required']);
  }

  if (incident.attempts >= manifest.max_fix_attempts) {
    return decision('escalate', null, 0, 1,
      [`${incident.attempts} remediation attempts already made (max ${manifest.max_fix_attempts})`]);
  }

  if (incident.severity === 'sev1') {
    return decision('escalate', null, 0, 1,
      ['sev1: platform or database unreachable -- infrastructure incident, not code-fixable from GitHub']);
  }

  if (manifest.autonomy_level <= 1) {
    return decision('observe', runbook, 0, runbook?.risk ?? 0, ['autonomy level 1: observe only']);
  }

  if (!runbook) {
    reasons.push(`no runbook for check "${incident.check_key}" -- needs a human diagnosis`);
    return decision('recommend', null, 0, 1, reasons);
  }

  let confidence = 0.5;
  reasons.push('base confidence 0.5 (matched runbook)');

  if (recall.matches >= 2 && (recall.success_rate ?? 0) >= 0.8) {
    confidence += 0.3;
    reasons.push(`recall: ${recall.matches} prior matches with success rate ${recall.success_rate} (+0.3)`);
  } else if (recall.matches >= 1 && (recall.success_rate ?? 0) >= 0.5) {
    confidence += 0.1;
    reasons.push(`recall: ${recall.matches} prior matches with success rate ${recall.success_rate} (+0.1)`);
  }

  if ((recall.rolled_back ?? 0) > 0) {
    confidence -= 0.2;
    reasons.push(`recall: ${recall.rolled_back} prior rollback(s) on this signature (-0.2)`);
  }

  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
  const risk = runbook.risk;

  if (manifest.autonomy_level < 3) {
    reasons.push('autonomy level 2: recommend only, human approval required');
    return decision('recommend', runbook, confidence, risk, reasons);
  }

  if (deploysLast6h >= manifest.max_deploys_per_6h) {
    reasons.push(`deploy budget exhausted (${deploysLast6h}/${manifest.max_deploys_per_6h} in 6h)`);
    return decision('recommend', runbook, confidence, risk, reasons);
  }

  if (confidence < 0.6) {
    reasons.push(`confidence ${confidence} below the 0.6 autonomy floor`);
    return decision('recommend', runbook, confidence, risk, reasons);
  }

  if (risk > 0.4) {
    reasons.push(`risk ${risk} above the 0.4 autonomy ceiling`);
    return decision('recommend', runbook, confidence, risk, reasons);
  }

  reasons.push('autonomy gates met: level >= 3, confidence >= 0.6, risk <= 0.4, deploy budget available');
  return decision('auto_remediate', runbook, confidence, risk, reasons);
}

function decision(action, runbook, confidence, risk, reasons) {
  return { action, runbook, confidence, risk, reasons };
}

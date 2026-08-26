/**
 * The reasoning step of the ecosystem intelligence loop (ADR-0015).
 *
 * A PURE function, deliberately: every branch below is a claim about when
 * a machine may act on its own, and those claims belong in something a
 * person can read and a test can pin -- not scattered through I/O code.
 * Generalizes the guardian's decide.js, which has been running these same
 * gates against Dot.Mines production since 2026-08-25.
 *
 * Brain thinks. It does not store (that is Memory) and does not act (that
 * is the executor).
 */

/** Autonomy ladder, weakest first (spec section 10). */
export const AUTONOMY_LADDER = ['observe', 'recommend', 'approve', 'execute', 'autonomous'];

const DEFAULT_POLICY = {
  // How far this subject/platform is allowed to climb, whatever the
  // evidence says. A ceiling is the operator's judgement and always wins.
  autonomy_ceiling: 'recommend',
  // Evidence gates for unattended action.
  min_confidence: 0.6,
  max_risk: 0.4,
  // Below this many graded attempts, history is an anecdote, not a rate.
  min_attempts_for_confidence: 2,
};

/**
 * @param {object} input
 * @param {object} input.context      Memory's evidence pack (what we know).
 * @param {object} input.proposal     { action_kind, risk, recommendation }.
 * @param {object} [input.policy]     Operator limits; merged over defaults.
 * @returns {{action: string, recommendation: string, confidence: number, risk: number,
 *   autonomy_level: string, requires_approval: boolean, rationale: string[]}}
 */
export function reason({ context, proposal, policy = {} }) {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const rationale = [];
  const risk = clamp(proposal?.risk ?? 0.5);

  // 1. Evidence. Confidence is earned from recorded outcomes for THIS kind
  //    of action -- never from the fact that a recommendation sounds good.
  const track = trackRecordFor(context, proposal?.action_kind);
  let confidence = 0.5;
  rationale.push('Starting from an even prior (0.5): no evidence either way.');

  if (!context?.known) {
    confidence = 0.3;
    rationale.length = 0;
    rationale.push('Nothing has ever been recorded about this subject, so any conclusion is a guess.');
  } else if (track.graded < rules.min_attempts_for_confidence) {
    rationale.push(
      track.graded === 0
        ? 'This kind of action has never been graded here, so past results cannot inform confidence.'
        : `Only ${track.graded} graded attempt(s) -- too few to read as a rate.`,
    );
  } else if (track.success_rate >= 0.8) {
    confidence += 0.3;
    rationale.push(`Worked ${track.improved} of ${track.graded} times here (${pct(track.success_rate)}).`);
  } else if (track.success_rate >= 0.5) {
    confidence += 0.1;
    rationale.push(`Mixed history: worked ${track.improved} of ${track.graded} times (${pct(track.success_rate)}).`);
  } else {
    confidence -= 0.2;
    rationale.push(`Mostly did not work here: ${track.improved} of ${track.graded} (${pct(track.success_rate)}).`);
  }

  if (track.worsened > 0) {
    confidence -= 0.1;
    rationale.push(`${track.worsened} past attempt(s) made things worse.`);
  }

  confidence = clamp(Number(confidence.toFixed(2)));

  // 2. Gates. Each one can only ever LOWER the outcome, so the weakest
  //    applicable constraint decides -- there is no path where evidence
  //    talks its way past an operator's ceiling.
  let level = 'autonomous';

  if (confidence < rules.min_confidence) {
    level = weaker(level, 'recommend');
    rationale.push(`Confidence ${confidence} is below the ${rules.min_confidence} bar for acting unattended.`);
  }

  if (risk > rules.max_risk) {
    level = weaker(level, 'approve');
    rationale.push(`Risk ${risk} is above the ${rules.max_risk} ceiling, so a person signs this off.`);
  }

  const ceiling = rules.autonomy_ceiling;
  if (AUTONOMY_LADDER.indexOf(ceiling) < AUTONOMY_LADDER.indexOf(level)) {
    level = ceiling;
    rationale.push(`Operator policy caps this subject at "${ceiling}".`);
  }

  if (!proposal?.action_kind) {
    level = weaker(level, 'observe');
    rationale.push('No action was proposed, so there is nothing to authorise.');
  }

  const requiresApproval = ['approve', 'recommend'].includes(level);

  return {
    action: level === 'observe' ? 'observe' : level === 'autonomous' || level === 'execute' ? 'execute' : 'recommend',
    recommendation: proposal?.recommendation ?? 'Keep watching; nothing to do yet.',
    confidence,
    risk,
    autonomy_level: level,
    requires_approval: requiresApproval,
    rationale,
  };
}

/**
 * What Memory knows about this exact kind of action for this subject.
 *
 * @returns {{attempts: number, graded: number, improved: number, worsened: number, success_rate: number}}
 */
export function trackRecordFor(context, actionKind) {
  const empty = { attempts: 0, graded: 0, improved: 0, worsened: 0, success_rate: 0 };
  const rows = context?.what_worked ?? [];
  const match = rows.find((row) => row.action_kind === actionKind);

  if (!match) {
    return empty;
  }

  return {
    attempts: match.attempts ?? 0,
    graded: match.graded ?? 0,
    improved: match.improved ?? 0,
    worsened: match.worsened ?? 0,
    success_rate: match.success_rate ?? 0,
  };
}

function weaker(a, b) {
  return AUTONOMY_LADDER.indexOf(a) <= AUTONOMY_LADDER.indexOf(b) ? a : b;
}

function clamp(n) {
  return Math.max(0, Math.min(1, n));
}

function pct(rate) {
  return `${Math.round((rate ?? 0) * 100)}%`;
}

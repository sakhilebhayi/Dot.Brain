/**
 * Ethics and Security gates for outbound Insights (design spec §2).
 * Governance is deliberately never invoked here — an Insight is never
 * applied to a platform, so there is no decision-rights question.
 *
 * Reuses the prohibited-target-metric list from brain.dopemine.md §2
 * verbatim, applied here to Insight targets the same way the Dopamine
 * gate already applies it to Recommendation impact blocks.
 */
export const PROHIBITED_TARGET_METRICS = [
  'raw_session_time',
  'app_open_count',
  'scroll_depth',
  'notification_click_through_terminal',
  'streak_length_for_its_own_sake',
  'variable_reward_schedule_effectiveness',
  'time_to_return_after_notification',
];

/**
 * @param {{targetMetric?: string}} insight
 * @returns {{passed: boolean, reason?: string}}
 */
export function runEthicsGate(insight) {
  const metric = insight?.targetMetric;
  if (metric && PROHIBITED_TARGET_METRICS.includes(metric)) {
    return { passed: false, reason: `"${metric}" is a prohibited engagement target (brain.dopemine.md §2).` };
  }
  return { passed: true };
}

/**
 * Classification-leak check: an insight's classification must be at or
 * below the target platform's clearance. `insight.classification`
 * defaults to 'public' when absent, matching "narrowed only" behavior
 * elsewhere in the Query API (brain.api.md §3).
 *
 * @param {{classification?: 'public'|'restricted'}} insight
 * @param {Array<'public'|'restricted'>} targetPlatformClearance
 * @returns {{passed: boolean, reason?: string}}
 */
export function runSecurityGate(insight, targetPlatformClearance) {
  const classification = insight?.classification ?? 'public';
  if (!targetPlatformClearance.includes(classification)) {
    return { passed: false, reason: `Target platform is not cleared for "${classification}" insights.` };
  }
  return { passed: true };
}

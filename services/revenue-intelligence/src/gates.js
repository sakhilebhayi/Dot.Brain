/**
 * Ethics and Security gates for revenue-intelligence-generated Insights.
 * Same shape as services/insight-delivery/src/gates.js -- duplicated
 * per this repo's established convention, not imported (design spec
 * Global Constraints).
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
 * Reads `x-classification` -- insight.schema.json is
 * additionalProperties:false and does not declare a plain
 * `classification` field, only the `^x-` extension pattern
 * (opportunities.js sets `x-classification`, not `classification`).
 *
 * @param {{'x-classification'?: 'public'|'restricted'}} insight
 * @param {Array<'public'|'restricted'>} targetPlatformClearance
 * @returns {{passed: boolean, reason?: string}}
 */
export function runSecurityGate(insight, targetPlatformClearance) {
  const classification = insight?.['x-classification'] ?? 'public';
  if (!targetPlatformClearance.includes(classification)) {
    return { passed: false, reason: `Target platform is not cleared for "${classification}" insights.` };
  }
  return { passed: true };
}

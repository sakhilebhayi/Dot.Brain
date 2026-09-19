/**
 * Routes a W3 reasoning conclusion to Recommendation or Insight
 * (design spec §1). A conclusion cannot be both. An ambiguous
 * conclusion always takes the stricter, human-reviewed path.
 *
 * @param {{impliesPlatformChange?: boolean}} conclusion
 * @returns {'recommendation'|'insight'}
 */
export function classifyConclusion(conclusion) {
  return conclusion?.impliesPlatformChange === false ? 'insight' : 'recommendation';
}

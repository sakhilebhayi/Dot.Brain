/**
 * Opportunity-detection heuristics over a Revenue Reader poll result
 * (design spec §1). Pure and total: an empty or all-non-matching
 * signals array returns [], never throws.
 */
export const CHURN_RATE_THRESHOLD = 0.05;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{platform: string, generated_at: string, classification: string, signals: object[]}} pollResult
 * @returns {object[]}
 */
export function detectOpportunities(pollResult) {
  const { platform, generated_at, classification, signals } = pollResult;
  const insights = [];

  for (const signal of signals) {
    if (signal.key === 'revenue.mrr' && signal.trend === 'down') {
      insights.push(buildInsight({
        statement: `MRR is trending down for ${platform}.`,
        platform, generated_at, classification, signal,
      }));
    } else if (signal.key === 'revenue.churn_rate' && signal.value > CHURN_RATE_THRESHOLD) {
      insights.push(buildInsight({
        statement: `Churn rate (${signal.value}) exceeds the ${CHURN_RATE_THRESHOLD * 100}% watch threshold for ${platform}.`,
        platform, generated_at, classification, signal,
      }));
    } else if (signal.key === 'finance.payout_delay_p50' && signal.trend === 'up') {
      insights.push(buildInsight({
        statement: `Payout delay is trending up for ${platform} -- an operational risk to revenue.`,
        platform, generated_at, classification, signal,
      }));
    }
  }

  return insights;
}

function buildInsight({ statement, platform, generated_at, classification, signal }) {
  return {
    statement,
    domain: 'revenue',
    method: 'threshold-rule',
    evidence: [{ kind: 'metric', reference: `${platform}:${signal.key}@${generated_at}` }],
    scope: 'admin',
    classification,
    valid_until: new Date(new Date(generated_at).getTime() + ONE_DAY_MS).toISOString(),
  };
}

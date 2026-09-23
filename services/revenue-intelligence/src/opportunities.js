/**
 * Opportunity-detection heuristics over a Revenue Reader poll result
 * (design spec §1). Pure and total: an empty, all-non-matching, or
 * malformed (missing/invalid generated_at) input returns [], never
 * throws.
 */
export const CHURN_RATE_THRESHOLD = 0.05;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{platform: string, generated_at: string, classification: string, signals: object[]}} pollResult
 * @returns {object[]}
 */
export function detectOpportunities(pollResult) {
  const { platform, generated_at, classification, signals } = pollResult;

  // revenue-reader's own contract validation does not require
  // generated_at (a defensive gap tracked separately) -- detection
  // stays total regardless: a poll result we can't timestamp produces
  // no candidates rather than crashing the pipeline.
  if (Number.isNaN(new Date(generated_at).getTime())) {
    return [];
  }

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
    // ADR-0018 Decision 4 and the cross-platform read access spec §4
    // both mandate 'external' for evidence sourced from a live
    // Revenue Reader poll (as opposed to 'metric', which is for
    // evidence already resident in Brain's own metric registry).
    evidence: [{ kind: 'external', reference: `${platform}:${signal.key}@${generated_at}` }],
    // insight.schema.json defines `scope` as "where the insight applies
    // (site, tenant, global)" -- the enrolling platform IS the tenant
    // this insight is scoped to. Who should RECEIVE the insight (admin
    // recipients) is a separate, delivery-time concern, never stored on
    // the Insight itself -- see deliver.js's `audience` parameter.
    scope: platform,
    // insight.schema.json is additionalProperties:false with `^x-` as
    // the only extension point, and does not declare `classification`
    // -- brain.security.md §2 treats classification as an envelope-
    // level concern, not a payload-body field. x-classification is the
    // sanctioned way to carry it on the payload body itself, which
    // gates.js's runSecurityGate reads.
    'x-classification': classification,
    valid_until: new Date(new Date(generated_at).getTime() + ONE_DAY_MS).toISOString(),
  };
}

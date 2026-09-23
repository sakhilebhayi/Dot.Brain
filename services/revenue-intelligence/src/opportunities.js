/**
 * Opportunity-detection heuristics over a Revenue Reader poll result
 * (design spec §1). Pure and total: an empty, all-non-matching, or
 * malformed input (missing/wrong-typed platform, unrecognized
 * classification, missing/wrong-typed/unparseable/out-of-range
 * generated_at, a missing or non-array signals, a non-object signal,
 * or a signal with a wrong-typed key/value) returns [], never throws.
 * This is a system boundary in its own right, not just downstream of
 * revenue-reader's contract validation -- cli.js's `detect` command
 * feeds it arbitrary, unvalidated JSON read straight from a file.
 */
export const CHURN_RATE_THRESHOLD = 0.05;

// Duplicated from services/revenue-reader/src/contract.js's CLASSIFICATIONS
// per this repo's established convention (every service owns its own
// small clients/constants rather than importing a sibling's).
const CLASSIFICATIONS = ['public', 'ecosystem', 'restricted', 'sensitive'];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{platform: string, generated_at: string, classification: string, signals: object[]}} pollResult
 * @returns {object[]}
 */
export function detectOpportunities(pollResult) {
  if (!pollResult || typeof pollResult !== 'object') {
    return [];
  }

  const { platform, generated_at, classification, signals } = pollResult;

  if (typeof platform !== 'string' || platform === '') {
    return [];
  }
  // Without this, a missing/invalid classification silently became an
  // omitted x-classification, which runSecurityGate defaults to
  // 'public' -- letting unclassified (or wrongly-classified) revenue
  // data flow to delivery as if it were the least sensitive tier.
  if (!CLASSIFICATIONS.includes(classification)) {
    return [];
  }
  if (typeof generated_at !== 'string') {
    return [];
  }
  const generatedAtMs = new Date(generated_at).getTime();
  if (Number.isNaN(generatedAtMs)) {
    return [];
  }

  // generated_at can be a syntactically valid, in-range-for-Date.parse
  // ISO string (e.g. an extended year) that is still too close to
  // Date's representable limit for +24h to stay valid -- computed once,
  // up front, so that failure mode is a clean [] rather than a crash
  // partway through the signals loop.
  let validUntil;
  try {
    validUntil = new Date(generatedAtMs + ONE_DAY_MS).toISOString();
  } catch {
    return [];
  }

  if (!Array.isArray(signals)) {
    return [];
  }

  const insights = [];

  for (const signal of signals) {
    if (!signal || typeof signal !== 'object') {
      continue;
    }
    // A wrong-typed key can never match a heuristic's key check below,
    // so it's already harmless -- but a wrong-typed value (e.g. `true`)
    // coerces through `signal.value > CHURN_RATE_THRESHOLD` and would
    // otherwise land in a generated statement (e.g. "Churn rate (true)
    // exceeds..."), which insight.schema.json documents as "a single
    // falsifiable assertion" -- not something a non-numeric value is.
    if (typeof signal.key !== 'string' || typeof signal.value !== 'number' || !Number.isFinite(signal.value)) {
      continue;
    }
    if (signal.key === 'revenue.mrr' && signal.trend === 'down') {
      insights.push(buildInsight({
        statement: `MRR is trending down for ${platform}.`,
        platform, generated_at, classification, signal, validUntil,
      }));
    } else if (signal.key === 'revenue.churn_rate' && signal.value > CHURN_RATE_THRESHOLD) {
      insights.push(buildInsight({
        statement: `Churn rate (${signal.value}) exceeds the ${CHURN_RATE_THRESHOLD * 100}% watch threshold for ${platform}.`,
        platform, generated_at, classification, signal, validUntil,
      }));
    } else if (signal.key === 'finance.payout_delay_p50' && signal.trend === 'up') {
      insights.push(buildInsight({
        statement: `Payout delay is trending up for ${platform} -- an operational risk to revenue.`,
        platform, generated_at, classification, signal, validUntil,
      }));
    }
  }

  return insights;
}

function buildInsight({ statement, platform, generated_at, classification, signal, validUntil }) {
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
    valid_until: validUntil,
  };
}

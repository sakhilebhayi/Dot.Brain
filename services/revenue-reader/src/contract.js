/**
 * Defensive contract validation for a dot-revenue/v1 response body
 * (design spec §1) -- a response is rejected as a contract failure,
 * never partially trusted, mirroring Guardian's health.js precedent.
 */
export const CLASSIFICATIONS = ['public', 'ecosystem', 'restricted', 'sensitive'];

/**
 * @param {object} body
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSignalsResponse(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, reason: 'response body is not an object' };
  }
  if (typeof body.generated_at !== 'string' || Number.isNaN(new Date(body.generated_at).getTime())) {
    return { valid: false, reason: 'generated_at must be a valid ISO date-time string' };
  }
  if (!CLASSIFICATIONS.includes(body.classification)) {
    return {
      valid: false,
      reason: `classification must be one of ${CLASSIFICATIONS.join(', ')}, got ${JSON.stringify(body.classification)}`,
    };
  }
  if (!Array.isArray(body.signals)) {
    return { valid: false, reason: 'signals must be an array' };
  }
  for (const [index, signal] of body.signals.entries()) {
    if (!signal || typeof signal !== 'object' || !signal.key || signal.value === undefined || signal.value === null) {
      return { valid: false, reason: `signals[${index}] is missing key or value` };
    }
  }
  return { valid: true };
}

/**
 * True when a response's declared classification exceeds the enrolling
 * platform's own classification_ceiling (design spec §4) -- rejected
 * outright as a `classification_ceiling` failure, the one rejection mode
 * Guardian's contract didn't need. Surfaced to the caller (see
 * client.js's `pollPlatform`) as a structured result; recording the
 * breach as a standing incident (ADR-0018 Decision 5) is a deferred
 * extension needing its own design -- see ADR-0018's Open questions.
 *
 * @param {string} classification
 * @param {string} ceiling
 * @returns {boolean}
 */
export function classificationExceedsCeiling(classification, ceiling) {
  return CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(ceiling);
}

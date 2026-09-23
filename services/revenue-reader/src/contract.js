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
    if (!signal || typeof signal !== 'object' || !signal.key || signal.value === undefined) {
      return { valid: false, reason: `signals[${index}] is missing key or value` };
    }
  }
  return { valid: true };
}

/**
 * True when a response's declared classification exceeds the enrolling
 * platform's own classification_ceiling (design spec §4) -- rejected
 * outright and raised as an incident, the one rejection mode Guardian's
 * contract didn't need.
 *
 * @param {string} classification
 * @param {string} ceiling
 * @returns {boolean}
 */
export function classificationExceedsCeiling(classification, ceiling) {
  return CLASSIFICATIONS.indexOf(classification) > CLASSIFICATIONS.indexOf(ceiling);
}

/**
 * Defensive contract validation for a dot-revenue/v1 response body
 * (design spec §1) -- a response is rejected as a contract failure,
 * never partially trusted, mirroring Guardian's health.js precedent.
 */
export const CLASSIFICATIONS = ['public', 'ecosystem', 'restricted', 'sensitive'];

const CONTRACT_ID = 'dot-revenue/v1';

// The full set of fields the dot-revenue/v1 contract documents for a
// signal entry (design spec §1): key/value required, the rest optional
// context. sanitizeSignal strips anything beyond this allowlist so a
// platform can't smuggle extra fields (e.g. raw transaction or PII-level
// data) across the boundary just by including them in the response body.
const SIGNAL_FIELDS = ['key', 'value', 'unit', 'period', 'trend', 'confidence'];

/**
 * @param {object} body
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateSignalsResponse(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, reason: 'response body is not an object' };
  }
  if (body.contract !== CONTRACT_ID) {
    return { valid: false, reason: `contract must be "${CONTRACT_ID}", got ${JSON.stringify(body.contract)}` };
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
    if (!signal || typeof signal !== 'object' || typeof signal.key !== 'string' || signal.key === '') {
      return { valid: false, reason: `signals[${index}] is missing key or value` };
    }
    if (typeof signal.value !== 'number' || !Number.isFinite(signal.value)) {
      return { valid: false, reason: `signals[${index}] is missing key or value` };
    }
  }
  return { valid: true };
}

/**
 * Strips a raw signal object down to the dot-revenue/v1 contract's
 * documented fields (design spec §1) -- called only after
 * validateSignalsResponse has already confirmed `key`/`value` are
 * present and well-typed. This is the boundary that keeps a platform's
 * response from carrying anything beyond pre-aggregated business
 * signals into Brain's process, however many extra fields the raw
 * payload happened to include.
 *
 * @param {object} signal
 * @returns {object}
 */
export function sanitizeSignal(signal) {
  const sanitized = {};
  for (const field of SIGNAL_FIELDS) {
    if (signal[field] !== undefined) {
      sanitized[field] = signal[field];
    }
  }
  return sanitized;
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

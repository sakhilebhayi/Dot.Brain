// services/brand-engine/src/score/constants.js
export const ENGINE_VERSION = '0.2.0';
export const REPORT_VERSION = '1.0.0';
export const EVIDENCE_VERSION = '1.0.0';

export const SOURCE_CLASSES = ['automated_check', 'expert_assessment', 'observed_behaviour', 'customer_feedback'];
export const OBSERVED_CLASSES = ['observed_behaviour', 'customer_feedback'];
export const STATES = ['not_ready', 'build_verified', 'release_ready'];
export const BANDS = ['Low', 'Medium', 'High'];

/** Exit codes of the score, compare and rubric commands. */
export const EXIT = { OK: 0, INVALID: 2, REFUSED: 3 };

export class EvidenceError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'EvidenceError';
    this.errors = errors;
  }
}

/** The input is well formed but the engine will not proceed (tampered rubric, major-version comparison). */
export class Refused extends Error {
  constructor(message) {
    super(message);
    this.name = 'Refused';
  }
}

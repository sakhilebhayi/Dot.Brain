// services/brand-engine/src/score/index.js
export { scoreReport } from './engine.js';
export { compareReports } from './compare.js';
export { validateEvidence, findSecretLike } from './evidence.js';
export { checkRubric, loadRubric, rubricHash, latestRubricRef, matchProhibited, indexRubric } from './rubric.js';
export { ENGINE_VERSION, REPORT_VERSION, EvidenceError, Refused } from './constants.js';

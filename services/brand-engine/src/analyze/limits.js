// services/brand-engine/src/analyze/limits.js
//
// Every bound in the analyse/workflow area, in one place so a test can pin
// them and a reader can see what the engine will and will not do with a
// hostile checkout or a hostile report.

/** The checkout file API (files.js). */
export const FILE_LIMITS = Object.freeze({
  maxFileBytes: 1024 * 1024,          // one read
  maxTotalReadBytes: 64 * 1024 * 1024, // all reads by one check
  maxListedFiles: 20000,
  maxDepth: 24,
  maxPathLength: 300,
  maxLineChars: 10000,                 // a longer line in js/css/html is minified or generated
  maxGlobs: 50,
  maxGlobLength: 200,
});

/** Directories nothing may list or read: vendored, generated or VCS content. */
export const SKIP_DIRS = Object.freeze([
  '.git', '.hg', '.svn', 'node_modules', 'vendor', 'build', 'dist', 'coverage',
  '.next', '.nuxt', '.cache', '.turbo', '.svelte-kit', 'bower_components', '__pycache__', '.venv', 'venv',
]);
/** Two-segment paths that are generated output (Laravel compiled views and caches). */
export const SKIP_PATHS = Object.freeze(['storage/framework', 'bootstrap/cache']);

/** Check execution (registry.js, check-worker.js). */
export const CHECK_LIMITS = Object.freeze({
  timeoutMs: 30000,
  metaTimeoutMs: 10000,
  maxOldGenerationSizeMb: 256,
  concurrency: 4,
  maxEvidencePerCheck: 200,
  maxFindingsPerCheck: 2000,
});

/** Output bounds: every string that came from a check or a report is clipped to these. */
export const TEXT_LIMITS = Object.freeze({
  message: 500,
  detail: 1000,
  fixHint: 500,
  path: 300,
  id: 80,
  title: 120,
  name: 200,
  findingsTotal: 10000,
});

/** External report files (adapters). */
export const REPORT_LIMITS = Object.freeze({
  maxFiles: 50,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxXmlDepth: 40,
  maxXmlNodes: 300000,
  maxTests: 100000,
  maxFindings: 5000,
  maxManualEntries: 500,
});

/** `impeccable detect` findings at or above this count score 0 (1 = none). Documented in the README. */
export const DETECTOR_CEILING = 10;

/** analysis.json / plan.json / verification.json are themselves inputs, so they are bounded too. */
export const DOC_MAX_BYTES = 16 * 1024 * 1024;

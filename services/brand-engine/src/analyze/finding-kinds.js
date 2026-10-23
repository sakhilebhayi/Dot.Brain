// services/brand-engine/src/analyze/finding-kinds.js
//
// How an analysis finding reaches the score. The rubric has five finding
// KINDS (wcag_failure, unsupported_claim, failing_test, domain_override_violation,
// ethics_gate_flag) and every one is a blocker or an advisory; an analysis
// finding only becomes one when it is a blocker (or an AAA WCAG note) and a
// kind can be named for it:
//   1. the finding says so itself (`kind`, plus `wcag_level` and
//      `wcag_criterion` for a WCAG failure), or
//   2. the check that raised it has a default kind (CHECK_KIND below).
// A blocker with no kind is NOT dropped: assembling evidence is refused and
// says which finding needs one, because a score that silently omits a blocker
// would be a score that lies.
import { FINDING_KINDS } from './check-shape.js';
import { TEXT_LIMITS } from './limits.js';
import { safeText } from './text.js';

export const CHECK_KIND = Object.freeze({
  'd8.token_pair_contrast': 'wcag_failure',
  'd8.axe_violations': 'wcag_failure',
  'd8.labels_alt_lang': 'wcag_failure',
  'd8.focus_visible': 'wcag_failure',
  'd6.claim_lint': 'unsupported_claim',
  'd5.test_pass_counts': 'failing_test',
  'd10.error_path_tests': 'failing_test',
});

/** Default WCAG 2.2 level and criterion for checks that measure exactly one thing. */
const WCAG_DEFAULT = Object.freeze({
  'd8.token_pair_contrast': { level: 'AA', criterion: '1.4.3' },
  'd8.focus_visible': { level: 'AA', criterion: '2.4.7' },
});
/** d8.labels_alt_lang covers three Level A criteria; the message says which. */
const LABELS_BY_WORD = [[/\balt\b|alternative text|image/i, '1.1.1'], [/\blang(uage)?\b/i, '3.1.1'], [/\blabel/i, '3.3.2']];

function wcagFor(f) {
  let level = f.wcag_level;
  let criterion = f.wcag_criterion;
  const d = WCAG_DEFAULT[f.check_id];
  if (d) { level ??= d.level; criterion ??= d.criterion; }
  if (f.check_id === 'd8.labels_alt_lang') {
    level ??= 'A';
    criterion ??= LABELS_BY_WORD.find(([re]) => re.test(f.message))?.[1];
  }
  return { level, criterion };
}

/**
 * -> { finding } for the evidence file, { skip: true } when the finding does
 * not reach the score (not a blocker), or { problem } when it must.
 */
export function toScoreFinding(f, sink) {
  const kind = f.kind ?? CHECK_KIND[f.check_id];
  const wcag = kind === 'wcag_failure' ? wcagFor(f) : {};
  const advisoryWcag = kind === 'wcag_failure' && wcag.level === 'AAA';
  if (f.severity !== 'blocker' && !advisoryWcag) return { skip: true };
  if (!kind || !FINDING_KINDS.includes(kind)) {
    return { problem: `finding ${f.id} is a blocker but has no score kind: set "kind" on it (wcag_failure, unsupported_claim, failing_test, domain_override_violation or ethics_gate_flag)` };
  }
  const base = {
    id: f.id,
    kind,
    detail: safeText(`${f.message}${f.location ? ` (${f.location.file}${f.location.line ? `:${f.location.line}` : ''})` : ''}`, TEXT_LIMITS.detail, sink),
    artifact_ref: (f.location?.file ?? f.origin ?? 'analysis').replace(/\s+/g, '_').slice(0, 300),
  };
  if (kind === 'wcag_failure') {
    if (!wcag.level) return { problem: `finding ${f.id} is a WCAG failure without a level: set "wcag_level"` };
    if (!wcag.criterion) return { problem: `finding ${f.id} is a WCAG ${wcag.level} failure without a criterion: set "wcag_criterion" (for example 1.4.3); the engine does not guess it` };
    return { finding: { ...base, level: wcag.level, criterion: wcag.criterion } };
  }
  if (kind === 'domain_override_violation') {
    return { finding: { ...base, dimension: f.dimension, ...(f.principle ? { principle: f.principle } : {}) } };
  }
  if (kind === 'ethics_gate_flag') return { finding: { ...base, resolved: false } };
  return { finding: base };
}

// services/brand-engine/src/score/text.js
//
// Every sentence the engine writes by itself lives here, as a fixed template
// with named holes. A report therefore contains only (a) text that came in as
// input, (b) ids from the rubric, profile and evidence, and (c) these
// templates filled with numbers and ids. The engine cannot assert that a user
// feels anything, because no template says so; a test enforces both halves.

export const TEMPLATES = {
  // evidence dispositions
  not_measured_check: 'Not measured: no result was supplied for this check. It counts as zero and is shown.',
  not_measured_metric: 'Not measured: no observed or customer result was supplied for this metric. It counts as zero and is shown.',
  not_measured_expert: 'Not measured: no counted expert assessment was supplied for this dimension. It counts as zero and is shown.',
  rejected_class_not_allowed: 'Rejected: the rubric does not allow {source_class} evidence for this dimension.',
  rejected_builder_sole_assessor: 'Rejected: {assessor} built this change and is the only assessor of this dimension. A builder is never the sole assessor of its own change.',
  rejected_below_minimum_n: 'Rejected: n is {n}, below the rubric minimum of {minimum}.',
  rejected_prohibited_engagement_metric: 'Rejected: {metric_id} is on the prohibited engagement list (brain.dopemine.md section 2) and is never scored. A person must review any proposal to use it.',
  recorded_builder_not_counted: 'Recorded, not counted: {assessor} built this change. An independent assessment of this dimension is counted instead.',
  corroborating_ai: 'Corroborating only: a human assessment of this dimension is counted, so this AI assessment is used to detect disagreement and carries no points.',

  // blockers
  blocker_wcag_failure: 'WCAG {level} failure of criterion {criterion}.',
  blocker_unsupported_claim: 'An unsupported claim was found.',
  blocker_failing_test: 'A test in scope fails.',
  blocker_domain_override_violation: 'A domain safety, regulatory or security override was violated.',
  blocker_ethics_gate_flag: 'An ethics-gate flag is unresolved.',
  advisory_wcag_failure: 'WCAG {level} failure of criterion {criterion}, recorded as advisory.',
  resolved_ethics_gate_flag: 'An ethics-gate flag was raised and is marked resolved.',

  // state
  state_build_verified_met: 'Attainment {attainment} percent meets the {minimum} percent minimum, there are no blockers, and every dimension meets its floor.',
  state_release_not_reached: 'release_ready is not reached: {count} condition(s) unmet, listed in release_ready_unmet.',
  state_release_ready_met: 'Every release_ready condition is met.',
  state_attainment_below_minimum: 'Attainment is {attainment} percent; build_verified needs at least {minimum} percent.',
  state_blockers_present: '{count} blocker(s) present.',
  state_floor_not_met: 'Dimension {dimension} reaches {value} percent of its non-observed ceiling; its floor is {floor} percent.',
  release_evidenced_below_minimum: 'Evidenced score is {evidenced}; release_ready needs at least {minimum}.',
  release_observed_missing: 'No counted observed or customer evidence for dimension {dimension}, which release_ready requires.',
  release_confidence_below_medium: 'Confidence is {band}; release_ready needs Medium or High.',
  release_profile_not_ratified: 'The profile is {status}, not ratified; a draft or proposed profile caps the state at build_verified.',
  release_rubric_not_ratified: 'The rubric is {status}, not ratified; a proposed rubric caps the state at build_verified.',
  release_builder_not_declared: 'Expert assessments were supplied but built_by was not, so assessor independence cannot be verified.',

  // confidence
  confidence_high: '{weight} points of weight carry two or more source classes including observed or customer evidence (minimum {minimum}).',
  confidence_medium: 'Automated and expert evidence agree on {weight} points of weight (minimum {minimum}); observed or customer evidence is not present on enough weight for High.',
  confidence_low_single_source: 'Automated and expert evidence together cover {weight} points of weight; {minimum} are needed for Medium.',
  confidence_low_disagreement: 'Evidence disagrees by more than {levels} level(s) on {count} dimension(s).',
  disagreement_detail: 'Evidence levels on this dimension span {low} to {high}; the spread exceeds {levels}.',
  confidence_saturated_left_out: '{count} automated result(s) reached their ceiling, so the value is a floor and not a level. They are scored as given and left out of the comparison with expert levels; a dimension whose only automated results are saturated does not count as having an automated source for confidence.',
  independence_unverified: 'built_by was not declared, so assessor independence is not verified.',

  // compare
  compare_identical: 'Both reports use the same rubric version and hash.',
  compare_patch: 'Rubric versions differ by patch ({a} and {b}): wording only, scores are unaffected.',
  compare_minor: 'Rubric versions differ by minor ({a} and {b}): checks or metrics were added, removed or re-defined, so part of any difference is methodology and not the product.',
  compare_major: 'Rubric versions differ by major ({a} and {b}): the dimension set, a weight or a cap changed. Both reports evaluate the same commit, so this compares methodologies and is not a measure of progress.',
  compare_profile_differs: 'The profile differs between the reports (baseline {a}, candidate {b}).',
  compare_engine_differs: 'The engine version differs between the reports (baseline {a}, candidate {b}).',
  compare_commit_differs: 'The reports were produced from different commits (baseline {a}, candidate {b}).',
  compare_commit_same: 'The reports were produced from the same commit.',
  compare_not_rebased: 'Scores are shown exactly as reported. Nothing was re-based, rescaled or re-run.',
  compare_refused_rubric_id: 'Refused: the reports use different rubrics ({a} and {b}).',
  compare_refused_hash: 'Refused: both reports claim rubric version {version} but record different hashes ({a} and {b}), so at least one was produced from a modified rubric.',
  compare_refused_major: 'Refused: the rubric major versions differ ({a} and {b}) and the reports are not both for the same commit ({commit_a} and {commit_b}). Scores are not comparable across a major version unless both are re-run on the same input.',
};

const HOLE = /\{([a-z_]+)\}/g;

/** Fill a template; a missing or extra hole is a programming error, never silently empty. */
export function say(key, args = {}) {
  const template = TEMPLATES[key];
  if (template === undefined) throw new Error(`unknown message ${key}`);
  const used = new Set();
  const text = template.replace(HOLE, (_, name) => {
    if (!Object.hasOwn(args, name)) throw new Error(`message ${key} needs ${name}`);
    used.add(name);
    return String(args[name]);
  });
  for (const name of Object.keys(args)) if (!used.has(name)) throw new Error(`message ${key} has no hole ${name}`);
  return text;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One anchored regex per template, so a test can prove a string is engine text. */
export const TEMPLATE_PATTERNS = Object.entries(TEMPLATES).map(([key, t]) => ({
  key,
  re: new RegExp(`^${t.split(HOLE).map((part, i) => (i % 2 === 0 ? escapeRe(part) : '.+?')).join('')}$`, 's'),
}));

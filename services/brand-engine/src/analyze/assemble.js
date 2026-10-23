// services/brand-engine/src/analyze/assemble.js
//
// evidence assemble: analysis.json (+ expert assessments + observed results)
// -> an evidence file `brand-engine score` accepts (schemas/brand-evidence.schema.json).
//
// Nothing is invented and nothing is dropped:
//   automated   every counted analysis evidence row, with its origin as the
//               artifact_ref (so each value traces to a check module or a report)
//   expert      the assessments file, as validated by the manual adapter
//   observed    the observed file, as validated by the manual adapter
//   findings    every analysis finding that reaches the score (a blocker with a
//               kind, or an AAA WCAG note); a blocker that cannot be given a kind
//               REFUSES the assembly instead of vanishing
// The result is validated with the scorer's own evidence validator before it is
// returned, so a file that comes out of here is a file `score` will take.
// `generated_at` is never read from a clock: it comes from --generated-at or,
// failing that, the latest `recorded_at` of the manual files.
// Provenance is kept in `x-provenance` (ignored by the scorer, bound into the
// report's evidence hash).
import { validateEvidence } from '../score/evidence.js';
import { toScoreFinding } from './finding-kinds.js';
import { byText } from './text.js';

export const EVIDENCE_VERSION = '1.0.0';
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class AssembleError extends Error {
  constructor(errors) {
    super(errors.join('\n'));
    this.name = 'AssembleError';
    this.errors = errors;
  }
}

/**
 * @param {object} o
 * @param {object} o.analysis     a verified analysis document
 * @param {object} o.rubric       the rubric the analysis names
 * @param {{recorded_at, assessors, expert, sha256}} [o.assessments]
 * @param {{recorded_at, observed, sha256}} [o.observed]
 */
export function assemble({ analysis, rubric, assessments, observed, builtBy, generatedAt, repo, commit, assistiveTechnologyTestingPossible = false }) {
  const errors = [];
  const sink = { redactions: 0 };

  const useRepo = analysis.input.repo ?? repo;
  const useCommit = analysis.input.commit ?? commit;
  if (analysis.input.repo && repo !== undefined && repo !== analysis.input.repo) errors.push(`--repo ${repo} contradicts the analysis (${analysis.input.repo})`);
  if (analysis.input.commit && commit !== undefined && commit !== analysis.input.commit) errors.push(`--commit ${commit} contradicts the analysis (${analysis.input.commit})`);
  if (!useRepo) errors.push('the analysis has no repository (it was not a git checkout with a GitHub origin); pass --repo <owner/name>');
  if (!useCommit) errors.push('the analysis has no commit; pass --commit <40 hex> for a checkout that is not a git repository');

  const stamps = [assessments?.recorded_at, observed?.recorded_at].filter(Boolean).sort();
  const stamp = generatedAt ?? stamps[stamps.length - 1];
  if (!stamp) errors.push('no generated_at: pass --generated-at <date-time> (the engine never reads a clock)');
  else if (!DATE_TIME.test(stamp) || Number.isNaN(Date.parse(stamp))) errors.push('--generated-at must be a date-time such as 2026-10-23T12:00:00Z');

  const findings = [];
  for (const f of analysis.findings.filter((x) => !x.engine)) {
    const r = toScoreFinding(f, sink);
    if (r.problem) errors.push(r.problem);
    else if (r.finding) findings.push(r.finding);
  }
  if (errors.length) throw new AssembleError(errors);

  const provenance = {
    analysis_sha256: analysis.integrity.sha256,
    ...(assessments ? { assessments_sha256: assessments.sha256 } : {}),
    ...(observed ? { observed_sha256: observed.sha256 } : {}),
    automated: Object.fromEntries(analysis.evidence.map((e) => [e.check_id, e.origin]).sort(([a], [b]) => byText(a, b))),
    profile: `${analysis.profile.id}@${analysis.profile.version}`,
    rubric: `${analysis.rubric.id}@${analysis.rubric.version}`,
  };

  const evidence = {
    evidence_version: EVIDENCE_VERSION,
    generated_at: stamp,
    input: { repo: useRepo, commit: useCommit, ...(analysis.input.scope ? { scope: analysis.input.scope } : {}) },
    ...(builtBy !== undefined ? { built_by: builtBy } : {}),
    context: { assistive_technology_testing_possible: assistiveTechnologyTestingPossible },
    assessors: assessments ? assessments.assessors : [],
    automated: analysis.evidence.map((e) => ({
      check_id: e.check_id, value: e.value, ...(e.detail ? { detail: e.detail } : {}),
      artifact_ref: `${e.origin}:${e.artifact_ref}`.replace(/\s+/g, '_').slice(0, 300),
    })),
    expert: assessments ? assessments.expert : [],
    observed: observed ? observed.observed : [],
    findings: findings.sort((a, b) => byText(a.id, b.id)),
    'x-provenance': provenance,
  };

  const problems = validateEvidence(evidence, rubric);
  if (problems.length) throw new AssembleError(problems.map((p) => `the assembled evidence is not acceptable to score: ${p}`));
  return evidence;
}


// Builders for synthetic evidence. Everything made here is a TEST FIXTURE: the
// repository, commit, assessors and values are invented to exercise the
// engine and say nothing about any product.
import { join } from 'node:path';
import { BRAND, clone, readJsonFile } from './_helpers.js';
import { loadRubric } from '../src/score/rubric.js';

export const RUBRIC = readJsonFile(join(BRAND, 'rubrics', 'bxqs-1.0.0.json'));
export const BUNDLE = loadRubric(BRAND, 'bxqs-1.0.0');
export const DIMS = RUBRIC.dimensions.map((d) => d.id);
export const dim = (id) => RUBRIC.dimensions.find((d) => d.id === id);

/** A resolved-profile stand-in with only the fields the engine reads. */
export const PROFILE = (overrides = {}) => ({
  id: 'fixture-product', kind: 'product', version: '0.1.0', effective_status: 'draft',
  chain: ['fixture-product@0.1.0', 'fixture-brand@0.1.0'],
  domain_overrides: [{ principle: 'BXP-04', yields_to: 'safety', reason: 'A fixture override: reassurance never softens a safety alert.', origin: 'fixture-brand@0.1.0' }],
  ...overrides,
});

export const HUMAN = { id: 'human-reviewer', kind: 'human' };
export const AI_A = { id: 'ai-reviewer-a', kind: 'ai' };
export const AI_B = { id: 'ai-reviewer-b', kind: 'ai' };
export const BUILDER = { id: 'ai-builder', kind: 'ai' };

export const ref = (what) => `artifact/${what}.json`;

/** Empty but valid evidence. */
export function emptyEvidence(extra = {}) {
  return {
    evidence_version: '1.0.0',
    generated_at: '2026-10-23T12:00:00Z',
    input: { repo: 'fixtures/synthetic-product', commit: 'a'.repeat(40) },
    context: { assistive_technology_testing_possible: false },
    assessors: [],
    automated: [], expert: [], observed: [], findings: [],
    'x-fixture-notice': 'Synthetic test fixture. Not a measurement of any product.',
    ...extra,
  };
}

/** Every check of the given dimensions measured at `value`. */
export function automatedFor(dimIds, value) {
  return dimIds.flatMap((id) => dim(id).evidence.automated_check.checks.map((c) => ({ check_id: c.id, value, artifact_ref: ref(c.id) })));
}

/** One expert assessment per expert-allowed dimension in `dimIds`. */
export function expertFor(dimIds, assessor, level) {
  return dimIds.filter((id) => dim(id).evidence.expert_assessment.allowed).map((id) => ({
    dimension: id, assessor: assessor.id, level, rationale: `Fixture rationale for ${id}.`, artifact_ref: ref(`${id}-${assessor.id}`),
  }));
}

/** Every observed and customer metric of the given dimensions at `value`, with `n` participants. */
export function observedFor(dimIds, value, n = 8) {
  return dimIds.flatMap((id) => ['observed_behaviour', 'customer_feedback'].flatMap((cls) => dim(id).evidence[cls].metrics.map((m) => ({
    dimension: id, source_class: cls, metric_id: m.id, value, n, method: 'Fixture method: synthetic sessions.', artifact_ref: ref(m.id),
  }))));
}

const MEASURABLE = DIMS.filter((id) => dim(id).cap_without_observed_or_customer > 0);

/** Automated 1.0 everywhere it can be, plus expert level 4 by the given assessors. */
export function buildSideEvidence({ automated = 1, expertLevel = 4, assessors = [HUMAN], builtBy = BUILDER.id } = {}) {
  const e = emptyEvidence({ assessors: [...assessors, BUILDER].filter((a, i, l) => l.findIndex((b) => b.id === a.id) === i) });
  if (builtBy !== undefined) e.built_by = builtBy;
  e.automated = automatedFor(MEASURABLE, automated);
  e.expert = assessors.flatMap((a) => expertFor(MEASURABLE, a, expertLevel));
  return e;
}

export const copy = clone;

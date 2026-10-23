// services/brand-engine/src/score/evidence.js
//
// Validation of the evidence file. Anything wrong here is INVALID INPUT (exit
// 2): the engine will not guess what a malformed file meant. The one thing it
// does not refuse is a well-formed entry the rubric will not count (a
// prohibited engagement metric, evidence of a class the dimension does not
// allow, a builder assessing its own change): those are scored as zero and
// shown as rejected in the report, so the producer can see why.
import { indexRubric, matchProhibited } from './rubric.js';
import { validateEvidenceShape } from './schemas.js';

// Shapes of credentials. Evidence is public-by-default (it ends up in a
// report in a repository), so a file that carries one is refused outright.
export const SECRET_SHAPES = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[abprs]-[A-Za-z0-9-]{10,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
];

function* strings(value, path = '$') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (let i = 0; i < value.length; i += 1) yield* strings(value[i], `${path}[${i}]`);
  else if (value !== null && typeof value === 'object') for (const k of Object.keys(value)) yield* strings(value[k], `${path}.${k}`);
}

/** Paths of strings that look like a credential. */
export function findSecretLike(value) {
  const hits = [];
  for (const [path, s] of strings(value)) if (SECRET_SHAPES.some((re) => re.test(s))) hits.push(path);
  return hits;
}

const dupes = (list) => {
  const seen = new Set();
  const out = new Set();
  for (const x of list) { if (seen.has(x)) out.add(x); seen.add(x); }
  return [...out];
};

/** Returns a list of problems; empty means the evidence can be scored. */
export function validateEvidence(evidence, rubric) {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return ['evidence must be a JSON object'];
  const shape = validateEvidenceShape(evidence);
  if (shape.length) return shape;

  const errors = [];
  const secrets = findSecretLike(evidence);
  for (const path of secrets) errors.push(`${path}: looks like a credential; evidence must not contain secrets`);

  const idx = indexRubric(rubric);
  const assessors = new Map();
  for (const a of evidence.assessors) {
    if (assessors.has(a.id)) errors.push(`assessors: duplicate id ${a.id}`);
    assessors.set(a.id, a.kind);
  }

  evidence.automated.forEach((e, i) => {
    if (!idx.checks.has(e.check_id)) errors.push(`$.automated[${i}]: unknown check_id ${e.check_id}`);
  });
  for (const d of dupes(evidence.automated.map((e) => e.check_id))) errors.push(`$.automated: more than one result for ${d}`);

  evidence.expert.forEach((e, i) => {
    if (!idx.dimensions.has(e.dimension)) errors.push(`$.expert[${i}]: unknown dimension ${e.dimension}`);
    if (!assessors.has(e.assessor)) errors.push(`$.expert[${i}]: assessor ${e.assessor} is not declared in assessors`);
  });
  for (const d of dupes(evidence.expert.map((e) => `${e.dimension}|${e.assessor}`))) errors.push(`$.expert: more than one assessment of ${d.replace('|', ' by ')}`);

  evidence.observed.forEach((e, i) => {
    if (!idx.dimensions.has(e.dimension)) { errors.push(`$.observed[${i}]: unknown dimension ${e.dimension}`); return; }
    if (matchProhibited(rubric, e.metric_id)) return; // rejected later, with a finding
    const metric = idx.metrics.get(`${e.dimension}|${e.metric_id}`);
    if (!metric) errors.push(`$.observed[${i}]: unknown metric_id ${e.metric_id} for ${e.dimension}`);
    else if (metric.source_class !== e.source_class) errors.push(`$.observed[${i}]: ${e.metric_id} is a ${metric.source_class} metric, not ${e.source_class}`);
  });
  for (const d of dupes(evidence.observed.map((e) => `${e.dimension}|${e.metric_id}`))) errors.push(`$.observed: more than one result for ${d.replace('|', ' ')}`);

  const effects = new Map(rubric.finding_effects.map((f) => [f.kind, f]));
  evidence.findings.forEach((f, i) => {
    const effect = effects.get(f.kind);
    const where = `$.findings[${i}]`;
    if (f.dimension !== undefined && !idx.dimensions.has(f.dimension)) errors.push(`${where}: unknown dimension ${f.dimension}`);
    if (effect.dimension && f.dimension !== undefined && f.dimension !== effect.dimension) errors.push(`${where}: ${f.kind} always affects ${effect.dimension}, not ${f.dimension}`);
    if (!effect.dimension && f.dimension === undefined && effect.max_fraction < 1) errors.push(`${where}: ${f.kind} must name the dimension it affects`);
    if (f.kind === 'wcag_failure') {
      if (f.level === undefined) errors.push(`${where}: wcag_failure needs level`);
      if (f.criterion === undefined) errors.push(`${where}: wcag_failure needs criterion`);
    } else {
      if (f.level !== undefined) errors.push(`${where}: level only applies to wcag_failure`);
      if (f.criterion !== undefined) errors.push(`${where}: criterion only applies to wcag_failure`);
    }
    if (f.resolved !== undefined && f.kind !== 'ethics_gate_flag') errors.push(`${where}: resolved only applies to ethics_gate_flag`);
    if (f.principle !== undefined && f.kind !== 'domain_override_violation') errors.push(`${where}: principle only applies to domain_override_violation`);
  });
  for (const d of dupes(evidence.findings.map((f) => f.id))) errors.push(`$.findings: duplicate id ${d}`);

  return errors;
}

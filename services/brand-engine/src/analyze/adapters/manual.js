// services/brand-engine/src/analyze/adapters/manual.js
//
// The two files a PERSON writes. Everything else the engine reads comes out of
// a tool; these carry judgement and observation, so they are validated
// strictly and nothing is ever filled in for the writer.
//
// ASSESSMENTS (format "brand-assessments/1" or "brand-assessments/2"): expert assessments.
//   { "format": "brand-assessments/2", "recorded_at": "<date-time>",
//     "assessors": [{ "id": "jane", "kind": "human" | "ai",
//                     "declaration"?: { "built_the_change"?: bool, "fresh_reviewer"?: bool,
//                                       "ai_only"?: bool, "statement"?: "<up to 700 characters>" } }],
//     "assessments": [{ "dimension": "<rubric dimension id>", "assessor": "jane",
//                       "level": 0-4, "notes": "<up to 700 characters>",
//                       "artifact_ref": "<path or url, no spaces>" }] }
//   The level is checked against the rubric's own anchors: the engine looks up
//   the anchor text for that level and records it in the rationale next to the
//   writer's notes, so a report shows what the level means and the writer cannot
//   claim a level without it being stated. Only dimensions whose rubric allows
//   expert evidence are accepted; one assessment per (dimension, assessor).
//   An "ai" assessor is recorded as ai (the scorer gives it at most half the
//   expert weight and never counts the builder).
//
//   DECLARATIONS (format /2 only; /1 files stay valid and unchanged). An assessor may say, in
//   its own words and flags, what it is: whether it built the change, whether it is a fresh
//   reviewer (took no part in the build or in earlier assessments of this change and saw no
//   earlier conclusions), and whether it is AI only (no human wrote or edited its levels and
//   notes). A declaration is RECORDED and nothing else: no scoring path reads it, so it can
//   never lift a number. It can only add refusals: a flag that contradicts the assessor's own
//   kind or another flag is an error here, and `evidence assemble` refuses one that contradicts
//   --built-by (the builder is whoever --built-by names, never whoever says they are not).
//
// OBSERVED (format "brand-observed/1"): results from people using the product.
//   { "format": "brand-observed/1", "recorded_at": "<date-time>",
//     "observations": [{ "dimension": "...", "source_class": "observed_behaviour"
//                        | "customer_feedback", "metric_id": "task_completion_rate",
//                        "value": 0-1, "n": <people>, "method": "<how it was run>",
//                        "participants": "human", "detail"?: "...",
//                        "artifact_ref": "..." }] }
//   The metric must be one the rubric defines for that dimension and class.
//   `participants` must be exactly "human": a simulated or AI-driven run is not
//   observed behaviour and is refused (record it as automated or expert
//   evidence). A prohibited engagement metric (session time, opens, streaks,
//   scroll depth, notification click-through, variable reward, time to return,
//   and aliases) is REFUSED with the reason, not dropped: a person must review
//   any proposal to measure it (brain.dopemine.md section 2).
//   n is not range-checked here: the scorer rejects n below the rubric minimum
//   and says so in the report.
import { REPORT_LIMITS } from '../limits.js';
import { plain } from '../text.js';
import { findSecretLike } from '../../score/evidence.js';
import { indexRubric, matchProhibited } from '../../score/rubric.js';
import { AdapterError, isObject, parseJson } from './common.js';

export const ASSESSMENTS_FORMAT = 'brand-assessments/1';
export const ASSESSMENTS_FORMAT_V2 = 'brand-assessments/2';
const ASSESSMENT_FORMATS = [ASSESSMENTS_FORMAT, ASSESSMENTS_FORMAT_V2];
export const DECLARATION_STATEMENT_MAX = 700;
export const OBSERVED_FORMAT = 'brand-observed/1';
const NOTES_MAX = 700;
const REF = /^[^\s]{1,300}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Which manual format a parsed document is, or null. */
export const manualFormat = (value) => (isObject(value) && (ASSESSMENT_FORMATS.includes(value.format) || value.format === OBSERVED_FORMAT) ? value.format : null);

function fail(file, kind, errors) {
  const shown = errors.slice(0, 20);
  throw new AdapterError(kind, file, `is not valid:\n  ${shown.join('\n  ')}${errors.length > shown.length ? `\n  (${errors.length - shown.length} more)` : ''}`);
}

function topLevel(doc, allowed, errors) {
  if (!isObject(doc)) { errors.push('$: must be a JSON object'); return; }
  for (const k of Object.keys(doc)) if (!allowed.includes(k) && !k.startsWith('x-')) errors.push(`$.${k}: is not an allowed property`);
  if (typeof doc.recorded_at !== 'string' || !DATE_TIME.test(doc.recorded_at) || Number.isNaN(Date.parse(doc.recorded_at))) errors.push('$.recorded_at: must be a date-time such as 2026-10-23T12:00:00Z');
}

function rejectSecrets(doc, errors) {
  for (const p of findSecretLike(doc)) errors.push(`${p}: looks like a credential; these files are published with the report`);
}

const DECLARATION_FLAGS = ['built_the_change', 'fresh_reviewer', 'ai_only'];

/** Validate one assessor declaration; returns the normalised object (flags, then statement) or undefined on error. */
export function checkDeclaration(d, kind, where, errors) {
  if (!isObject(d)) { errors.push(`${where}: must be an object`); return undefined; }
  const before = errors.length;
  for (const k of Object.keys(d)) if (![...DECLARATION_FLAGS, 'statement'].includes(k)) errors.push(`${where}.${k}: is not an allowed property`);
  for (const f of DECLARATION_FLAGS) if (d[f] !== undefined && typeof d[f] !== 'boolean') errors.push(`${where}.${f}: must be true or false`);
  if (d.statement !== undefined && (typeof d.statement !== 'string' || plain(d.statement) === '' || plain(d.statement).length > DECLARATION_STATEMENT_MAX)) errors.push(`${where}.statement: must be 1 to ${DECLARATION_STATEMENT_MAX} characters`);
  if (Object.keys(d).length === 0) errors.push(`${where}: must declare at least one thing`);
  if (d.built_the_change === true && d.fresh_reviewer === true) errors.push(`${where}: an assessor that built the change cannot also be a fresh reviewer`);
  if (d.ai_only !== undefined && typeof d.ai_only === 'boolean' && (kind === 'human' || kind === 'ai') && d.ai_only !== (kind === 'ai')) {
    errors.push(`${where}.ai_only: ${d.ai_only} contradicts kind "${kind}" (a human assessor is not AI only, an AI assessor is; if a person reviewed or edited the levels, record that person as a separate human assessor)`);
  }
  if (errors.length > before) return undefined;
  const out = {};
  for (const f of DECLARATION_FLAGS) if (d[f] !== undefined) out[f] = d[f];
  if (d.statement !== undefined) out.statement = plain(d.statement);
  return out;
}

export function parseAssessments(file, text, rubric) {
  const kind = 'assessments';
  const doc = parseJson(kind, file, text);
  const errors = [];
  topLevel(doc, ['format', 'recorded_at', 'assessors', 'assessments'], errors);
  if (isObject(doc) && !ASSESSMENT_FORMATS.includes(doc.format)) errors.push(`$.format: must be "${ASSESSMENTS_FORMAT}" or "${ASSESSMENTS_FORMAT_V2}"`);
  const v2 = isObject(doc) && doc.format === ASSESSMENTS_FORMAT_V2;
  const idx = indexRubric(rubric);
  const assessors = new Map();
  const declarations = new Map();
  const expert = [];
  if (isObject(doc)) {
    if (!Array.isArray(doc.assessors) || doc.assessors.length === 0) errors.push('$.assessors: must be a non-empty array');
    else doc.assessors.forEach((a, i) => {
      const w = `$.assessors[${i}]`;
      if (!isObject(a)) { errors.push(`${w}: must be an object`); return; }
      for (const k of Object.keys(a)) {
        if (k === 'declaration' && !v2) errors.push(`${w}.declaration: needs format "${ASSESSMENTS_FORMAT_V2}" (a /1 file carries no declarations)`);
        else if (!['id', 'kind', 'declaration'].includes(k)) errors.push(`${w}.${k}: is not an allowed property`);
      }
      if (typeof a.id !== 'string' || a.id.trim() === '' || a.id.length > 100 || plain(a.id) !== a.id) errors.push(`${w}.id: must be a plain string of 1 to 100 characters`);
      else if (assessors.has(a.id)) errors.push(`${w}.id: duplicate assessor ${a.id}`);
      if (a.kind !== 'human' && a.kind !== 'ai') errors.push(`${w}.kind: must be "human" or "ai"`);
      if (a.declaration !== undefined && v2) declarations.set(a.id, checkDeclaration(a.declaration, a.kind, `${w}.declaration`, errors));
      if (typeof a.id === 'string' && (a.kind === 'human' || a.kind === 'ai')) assessors.set(a.id, a.kind);
    });
    if (!Array.isArray(doc.assessments)) errors.push('$.assessments: must be an array');
    else {
      if (doc.assessments.length > REPORT_LIMITS.maxManualEntries) errors.push(`$.assessments: more than ${REPORT_LIMITS.maxManualEntries} entries`);
      const seen = new Set();
      doc.assessments.slice(0, REPORT_LIMITS.maxManualEntries).forEach((e, i) => {
        const w = `$.assessments[${i}]`;
        if (!isObject(e)) { errors.push(`${w}: must be an object`); return; }
        for (const k of Object.keys(e)) if (!['dimension', 'assessor', 'level', 'notes', 'artifact_ref'].includes(k)) errors.push(`${w}.${k}: is not an allowed property`);
        const dim = typeof e.dimension === 'string' ? idx.dimensions.get(e.dimension) : undefined;
        if (!dim) errors.push(`${w}.dimension: unknown dimension ${typeof e.dimension === 'string' ? e.dimension.slice(0, 60) : typeof e.dimension}`);
        else if (!dim.evidence.expert_assessment.allowed) errors.push(`${w}.dimension: ${e.dimension} cannot be assessed by an expert (outcome-defined); only observed or customer evidence applies`);
        if (typeof e.assessor !== 'string' || !assessors.has(e.assessor)) errors.push(`${w}.assessor: ${typeof e.assessor === 'string' ? e.assessor.slice(0, 60) : 'missing'} is not declared in assessors`);
        if (!Number.isInteger(e.level) || e.level < 0 || e.level > rubric.policy.expert_level_max) errors.push(`${w}.level: must be an integer from 0 to ${rubric.policy.expert_level_max}`);
        if (typeof e.notes !== 'string' || plain(e.notes) === '') errors.push(`${w}.notes: must say why, in the assessor's words`);
        else if (plain(e.notes).length > NOTES_MAX) errors.push(`${w}.notes: longer than ${NOTES_MAX} characters`);
        if (typeof e.artifact_ref !== 'string' || !REF.test(e.artifact_ref)) errors.push(`${w}.artifact_ref: must be a path or URL without spaces (up to 300 characters)`);
        if (dim && typeof e.assessor === 'string' && Number.isInteger(e.level) && e.level >= 0 && e.level <= 4 && typeof e.notes === 'string' && typeof e.artifact_ref === 'string') {
          const key = `${e.dimension}|${e.assessor}`;
          if (seen.has(key)) errors.push(`${w}: more than one assessment of ${e.dimension} by ${e.assessor}`);
          seen.add(key);
          const anchor = dim.evidence.expert_assessment.levels.find((l) => l.level === e.level)?.anchor ?? '';
          const rationale = `Level ${e.level} (rubric anchor: ${anchor}) Assessor notes: ${plain(e.notes)}`;
          if (rationale.length > 1000) errors.push(`${w}.notes: too long to record beside the rubric anchor for level ${e.level} (shorten by ${rationale.length - 1000})`);
          expert.push({ dimension: e.dimension, assessor: e.assessor, level: e.level, rationale, artifact_ref: e.artifact_ref });
        }
      });
    }
  }
  rejectSecrets(doc, errors);
  if (errors.length) fail(file, kind, errors);
  return {
    recorded_at: doc.recorded_at,
    assessors: [...assessors].map(([id, k]) => ({ id, kind: k, ...(declarations.get(id) ? { declaration: declarations.get(id) } : {}) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
    expert,
  };
}

export function parseObserved(file, text, rubric) {
  const kind = 'observed';
  const doc = parseJson(kind, file, text);
  const errors = [];
  topLevel(doc, ['format', 'recorded_at', 'observations'], errors);
  if (isObject(doc) && doc.format !== OBSERVED_FORMAT) errors.push(`$.format: must be "${OBSERVED_FORMAT}"`);
  const idx = indexRubric(rubric);
  const observed = [];
  if (isObject(doc)) {
    if (!Array.isArray(doc.observations)) errors.push('$.observations: must be an array');
    else {
      if (doc.observations.length > REPORT_LIMITS.maxManualEntries) errors.push(`$.observations: more than ${REPORT_LIMITS.maxManualEntries} entries`);
      const seen = new Set();
      doc.observations.slice(0, REPORT_LIMITS.maxManualEntries).forEach((e, i) => {
        const w = `$.observations[${i}]`;
        if (!isObject(e)) { errors.push(`${w}: must be an object`); return; }
        for (const k of Object.keys(e)) if (!['dimension', 'source_class', 'metric_id', 'value', 'n', 'method', 'participants', 'detail', 'artifact_ref'].includes(k)) errors.push(`${w}.${k}: is not an allowed property`);
        if (typeof e.metric_id === 'string') {
          const banned = matchProhibited(rubric, e.metric_id);
          if (banned) { errors.push(`${w}.metric_id: ${e.metric_id.slice(0, 60)} is a prohibited engagement metric (${banned.source}); it is refused, and a person must review any proposal to measure it`); return; }
        }
        const dim = typeof e.dimension === 'string' ? idx.dimensions.get(e.dimension) : undefined;
        if (!dim) errors.push(`${w}.dimension: unknown dimension ${typeof e.dimension === 'string' ? e.dimension.slice(0, 60) : typeof e.dimension}`);
        if (e.source_class !== 'observed_behaviour' && e.source_class !== 'customer_feedback') errors.push(`${w}.source_class: must be "observed_behaviour" or "customer_feedback"`);
        const metric = dim && typeof e.metric_id === 'string' ? idx.metrics.get(`${e.dimension}|${e.metric_id}`) : undefined;
        if (dim && !metric) errors.push(`${w}.metric_id: ${typeof e.metric_id === 'string' ? e.metric_id.slice(0, 60) : 'missing'} is not a metric the rubric defines for ${e.dimension}`);
        else if (metric && metric.source_class !== e.source_class) errors.push(`${w}.source_class: ${e.metric_id} is a ${metric.source_class} metric, not ${String(e.source_class).slice(0, 40)}`);
        if (typeof e.value !== 'number' || !Number.isFinite(e.value) || e.value < 0 || e.value > 1) errors.push(`${w}.value: must be a number from 0 to 1 (1 is best)`);
        if (!Number.isInteger(e.n) || e.n < 1) errors.push(`${w}.n: must be a whole number of people, at least 1`);
        if (typeof e.method !== 'string' || plain(e.method) === '' || plain(e.method).length > 1000) errors.push(`${w}.method: must say how this was run (1 to 1000 characters)`);
        if (e.participants !== 'human') errors.push(`${w}.participants: must be "human". A simulated or AI-driven run is not observed behaviour or customer feedback`);
        if (e.detail !== undefined && (typeof e.detail !== 'string' || plain(e.detail) === '' || plain(e.detail).length > 1000)) errors.push(`${w}.detail: must be 1 to 1000 characters`);
        if (typeof e.artifact_ref !== 'string' || !REF.test(e.artifact_ref)) errors.push(`${w}.artifact_ref: must be a path or URL without spaces (up to 300 characters)`);
        if (metric) {
          const key = `${e.dimension}|${e.metric_id}`;
          if (seen.has(key)) errors.push(`${w}: more than one result for ${e.dimension} ${e.metric_id}`);
          seen.add(key);
          observed.push({
            dimension: e.dimension, source_class: e.source_class, metric_id: e.metric_id, value: e.value, n: e.n,
            method: plain(e.method ?? ''), ...(e.detail ? { detail: plain(e.detail) } : {}), artifact_ref: e.artifact_ref,
          });
        }
      });
    }
  }
  rejectSecrets(doc, errors);
  if (errors.length) fail(file, kind, errors);
  return { recorded_at: doc.recorded_at, observed };
}

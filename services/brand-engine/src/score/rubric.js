// services/brand-engine/src/score/rubric.js
//
// Loading, checking and pinning a rubric. A released rubric is IMMUTABLE: its
// canonical sha256 is recorded in brand/rubrics/released.json and in every
// report, and a rubric whose hash no longer matches is refused, not scored
// with. Ratification is a separate record that names the hash it ratified, so
// the owner can ratify a rubric without editing (and so re-hashing) it.
import { join } from 'node:path';
import { readJson } from '../json.js';
import { compareSemver, parseSemver } from '../semver.js';
import { OBSERVED_CLASSES, Refused } from './constants.js';
import { validateRubricShape } from './schemas.js';
import { canonicalHash, normaliseId, settle } from './util.js';

export const DIMENSION_ORDER = [
  'emotional_clarity_positioning', 'brand_distinctiveness', 'usability_cognitive_load', 'visual_interaction_craftsmanship',
  'functional_completeness', 'trust_transparency', 'perceived_demonstrated_value', 'accessibility_inclusion',
  'cross_platform_consistency', 'reliability_error_recovery', 'retention_continuing_value', 'measurable_customer_outcomes',
];

const same = (a, b) => settle(a) === settle(b);

/** Cross-field rules the schema cannot express. Returns a list of problems. */
export function checkRubric(rubric) {
  const errors = [];
  const dims = rubric.dimensions;

  if (dims.map((d) => d.id).join() !== DIMENSION_ORDER.join()) errors.push('dimensions must be the twelve dimensions in the fixed order');
  dims.forEach((d, i) => { if (d.order !== i + 1) errors.push(`${d.id}: order must be ${i + 1}`); });

  const total = dims.reduce((s, d) => s + d.weight, 0);
  if (total !== rubric.policy.total_points) errors.push(`weights sum to ${total}, not exactly ${rubric.policy.total_points}`);

  const ids = new Set();
  const claim = (id, where) => {
    if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
    ids.add(id);
  };

  for (const d of dims) {
    const ev = d.evidence;
    const a = d.shares.automated_check;
    const x = d.shares.expert_assessment;
    const o = d.shares.observed_or_customer;
    if (!same(a + x + o, 1)) errors.push(`${d.id}: shares must sum to 1 (got ${settle(a + x + o)})`);
    if (!same(d.cap_without_observed_or_customer, a + x)) errors.push(`${d.id}: cap_without_observed_or_customer must equal the automated plus expert share`);
    if (!same(d.cap_without_observed_or_customer, 1 - o)) errors.push(`${d.id}: cap_without_observed_or_customer must equal 1 minus the observed-or-customer share`);
    if (d.measurable_without_observed_or_customer !== d.cap_without_observed_or_customer > 0) errors.push(`${d.id}: measurable_without_observed_or_customer must match whether the cap is above zero`);
    if (d.cap_without_observed_or_customer === 0 && d.floor !== 0) errors.push(`${d.id}: a dimension that cannot be measured without observed or customer evidence has no build-verified floor`);

    // Automated.
    if (ev.automated_check.allowed) {
      if (ev.automated_check.checks.length === 0) errors.push(`${d.id}: automated evidence is allowed but no check is defined`);
      if (a <= 0) errors.push(`${d.id}: automated evidence is allowed but its share is zero`);
    } else {
      if (ev.automated_check.checks.length) errors.push(`${d.id}: automated evidence is not allowed but checks are defined`);
      if (a !== 0) errors.push(`${d.id}: automated evidence is not allowed but its share is not zero`);
    }
    if (ev.automated_check.checks.length) {
      const sum = ev.automated_check.checks.reduce((s, c) => s + c.weight, 0);
      if (sum !== 100) errors.push(`${d.id}: check weights sum to ${sum}, not 100`);
      for (const c of ev.automated_check.checks) {
        claim(c.id, d.id);
        const want = `d${d.order}.`;
        if (!c.id.startsWith(want)) errors.push(`${d.id}: check ${c.id} must start with ${want}`);
      }
    }

    // Expert.
    const ex = ev.expert_assessment;
    if (ex.allowed) {
      if (x <= 0) errors.push(`${d.id}: expert evidence is allowed but its share is zero`);
      const levels = ex.levels.map((l) => l.level).join();
      if (levels !== '0,1,2,3,4') errors.push(`${d.id}: expert levels must be exactly 0 to 4 in order, each with an anchor`);
    } else {
      if (ex.levels.length) errors.push(`${d.id}: expert evidence is not allowed but levels are defined`);
      if (x !== 0) errors.push(`${d.id}: expert evidence is not allowed but its share is not zero`);
    }

    // Observed and customer.
    const metrics = [...ev.observed_behaviour.metrics, ...ev.customer_feedback.metrics];
    if (o > 0 && metrics.length === 0) errors.push(`${d.id}: an observed-or-customer share exists but no metric is defined`);
    if (metrics.length) {
      const sum = metrics.reduce((s, m) => s + m.weight, 0);
      if (sum !== 100) errors.push(`${d.id}: observed and customer metric weights sum to ${sum}, not 100`);
    }
    for (const cls of OBSERVED_CLASSES) {
      if (!ev[cls].allowed && ev[cls].metrics.length) errors.push(`${d.id}: ${cls} is not allowed but metrics are defined`);
      for (const m of ev[cls].metrics) {
        claim(m.id, d.id);
        if (m.id.includes('.')) errors.push(`${d.id}: metric id ${m.id} must not contain a dot`);
      }
    }
  }

  for (const d of dims.filter((dim) => dim.cap_without_observed_or_customer === 0)) {
    if (d.evidence.automated_check.allowed || d.evidence.expert_assessment.allowed) errors.push(`${d.id}: outcome-defined, so only observed or customer evidence may be allowed`);
  }
  for (const id of ['retention_continuing_value', 'measurable_customer_outcomes']) {
    const d = dims.find((dim) => dim.id === id);
    if (d && (d.cap_without_observed_or_customer !== 0 || d.shares.observed_or_customer !== 1)) errors.push(`${id}: must be unmeasurable without observed or customer evidence (cap 0)`);
  }

  // Finding effects.
  const kinds = new Set();
  for (const f of rubric.finding_effects) {
    if (kinds.has(f.kind)) errors.push(`finding_effects: duplicate kind ${f.kind}`);
    kinds.add(f.kind);
    if (f.dimension && !DIMENSION_ORDER.includes(f.dimension)) errors.push(`finding_effects ${f.kind}: unknown dimension ${f.dimension}`);
    if (f.blocker_levels && f.kind !== 'wcag_failure') errors.push(`finding_effects ${f.kind}: blocker_levels only applies to wcag_failure`);
  }
  for (const k of ['wcag_failure', 'unsupported_claim', 'failing_test', 'domain_override_violation', 'ethics_gate_flag']) {
    if (!kinds.has(k)) errors.push(`finding_effects: missing kind ${k}`);
  }

  // Prohibited metrics must not collide with the metrics the rubric accepts.
  const accepted = new Set(dims.flatMap((d) => [...d.evidence.observed_behaviour.metrics, ...d.evidence.customer_feedback.metrics].map((m) => m.id)));
  for (const p of rubric.prohibited_metrics) {
    for (const name of [p.id, ...p.aliases]) {
      if (accepted.has(name)) errors.push(`prohibited metric ${name} is also an accepted metric`);
    }
  }
  return errors;
}

export const rubricHash = (rubric) => canonicalHash(rubric);

/** The prohibited-metric entry a supplied metric id matches (exact or as a whole-word run), or null. */
export function matchProhibited(rubric, rawMetricId) {
  const id = normaliseId(rawMetricId);
  const padded = `_${id}_`;
  for (const p of rubric.prohibited_metrics) {
    for (const name of [p.id, ...p.aliases]) {
      if (id === name || padded.includes(`_${name}_`)) return p;
    }
  }
  return null;
}

/** Flat lookups used by the engine and by evidence validation. */
export function indexRubric(rubric) {
  const checks = new Map();
  const metrics = new Map();
  for (const d of rubric.dimensions) {
    for (const c of d.evidence.automated_check.checks) checks.set(c.id, { dimension: d.id, ...c });
    for (const cls of OBSERVED_CLASSES) {
      for (const m of d.evidence[cls].metrics) metrics.set(`${d.id}|${m.id}`, { dimension: d.id, source_class: cls, ...m });
    }
  }
  return { checks, metrics, dimensions: new Map(rubric.dimensions.map((d) => [d.id, d])) };
}

// ---------- files ----------

const RELEASED = 'released.json';
const REF = /^([a-z][a-z0-9-]*)-(\d+\.\d+\.\d+)$/;

export function rubricsDir(brandDir) { return join(brandDir, 'rubrics'); }

function readReleased(dir) {
  const read = readJson(join(dir, RELEASED), { followSymlinks: false });
  if (!read.ok) throw new Refused(`cannot read ${RELEASED}: ${read.error}`);
  const rubrics = read.value.released;
  if (rubrics === null || typeof rubrics !== 'object' || Array.isArray(rubrics)) throw new Refused(`${RELEASED}: "released" must be an object`);
  return rubrics;
}

/** Highest released version of rubric `id`, e.g. "bxqs-1.0.0". */
export function latestRubricRef(brandDir, id = 'bxqs') {
  const released = readReleased(rubricsDir(brandDir))[id] ?? {};
  const versions = Object.keys(released).filter((v) => parseSemver(v)).sort((a, b) => compareSemver(a, b));
  if (!versions.length) throw new Refused(`no released rubric ${id}`);
  return `${id}-${versions[versions.length - 1]}`;
}

/** Form check of a ratification record. It names the hash it ratified. */
export function checkRatificationRecord(rec, { id, version, sha256 }) {
  const errors = [];
  if (rec === null || typeof rec !== 'object' || Array.isArray(rec)) return ['ratification record must be an object'];
  if (rec.rubric_id !== id || rec.rubric_version !== version) errors.push(`ratification names ${rec.rubric_id}@${rec.rubric_version}, not ${id}@${version}`);
  if (rec.rubric_sha256 !== sha256) errors.push('ratification names a different rubric hash: the rubric changed after it was ratified');
  if (rec.status !== 'ratified') errors.push('status must be "ratified"');
  if (!rec.approver || rec.approver.kind !== 'human' || typeof rec.approver.id !== 'string' || !rec.approver.id) errors.push('approver must be a human with an id');
  if (typeof rec.ratified_at !== 'string' || Number.isNaN(Date.parse(rec.ratified_at))) errors.push('ratified_at must be a date-time');
  return errors;
}

/**
 * Load, check and pin a rubric. Throws Refused for anything that must stop a
 * run: unreadable, invalid, unreleased, modified since release, or a stale
 * ratification. Returns {rubric, sha256, ref, ratification|null}.
 */
export function loadRubric(brandDir, ref) {
  const dir = rubricsDir(brandDir);
  const wanted = ref ?? latestRubricRef(brandDir);
  const m = REF.exec(wanted);
  if (!m) throw new Refused(`rubric reference "${wanted}" must look like bxqs-1.0.0`);
  const [, id, version] = m;

  const read = readJson(join(dir, `${wanted}.json`), { followSymlinks: false });
  if (!read.ok) throw new Refused(`cannot read rubric ${wanted}: ${read.error}`);
  const rubric = read.value;
  const shape = validateRubricShape(rubric);
  if (shape.length) throw new Refused(`rubric ${wanted} is not valid:\n${shape.join('\n')}`);
  if (rubric.id !== id || rubric.version !== version) throw new Refused(`rubric file ${wanted}.json declares ${rubric.id}@${rubric.version}`);
  const problems = checkRubric(rubric);
  if (problems.length) throw new Refused(`rubric ${wanted} is not valid:\n${problems.join('\n')}`);

  const sha256 = rubricHash(rubric);
  const entry = readReleased(dir)[id]?.[version];
  if (!entry) throw new Refused(`rubric ${wanted} is not in ${RELEASED}; only a released rubric can score`);
  if (entry.sha256 !== sha256) {
    throw new Refused(`rubric ${wanted} has been modified since release (recorded ${entry.sha256}, actual ${sha256}); a released rubric is immutable, so a change must be a new version`);
  }

  let ratification = null;
  const rec = readJson(join(dir, `${wanted}.ratification.json`), { followSymlinks: false });
  if (rec.ok) {
    const bad = checkRatificationRecord(rec.value, { id, version, sha256 });
    if (bad.length) throw new Refused(`ratification of ${wanted} is not valid:\n${bad.join('\n')}`);
    ratification = { rubric_sha256: sha256, approver: rec.value.approver, ratified_at: rec.value.ratified_at };
  } else if (!/ENOENT/.test(rec.error)) {
    throw new Refused(`ratification of ${wanted}: ${rec.error}`);
  }
  return { rubric, sha256, ref: wanted, ratification };
}

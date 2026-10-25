// services/brand-engine/src/rules.js
//
// The cross-field rules a JSON Schema cannot express. PURE functions over
// parsed documents, in the style of services/infodot-knowledge/src/rules.js:
// each rule is a claim about when knowledge may be called what it claims to
// be, so it lives somewhere a person can read and a test can pin.
//
// Governance stance (ADR-0021, brain.brand_experience.md):
//   * An AI session may PROPOSE a profile or principle and may never
//     ratify one. "Strategic direction" is Level 3 (brain.autonomy.md).
//   * What a file says about its own approval is a FORM check, not proof.
//     Authenticity comes from review of the path (CODEOWNERS) and the owner's
//     merge; the validator makes the false claims that can be detected
//     mechanically impossible to merge by accident.
//   * Evidence is classed, and a class may not be dressed as a stronger one.
import { compareSemver, parseIdVersion } from './semver.js';

export const STATUSES = ['draft', 'proposed', 'ratified', 'superseded'];
export const EVIDENCE_CLASSES = ['documented_research', 'observed_behaviour', 'internal_hypothesis', 'validated_finding', 'declared_intent'];

// Fields each evidence class must carry and may carry. Anything else is a
// field borrowed from a stronger class, which is how weak evidence gets
// laundered into strong evidence.
const CLASS_FIELDS = {
  documented_research: { required: ['citation', 'citation_verified'], allowed: [] },
  observed_behaviour: { required: ['n', 'method'], allowed: [] },
  internal_hypothesis: { required: ['rationale'], allowed: [] },
  validated_finding: { required: ['experiment_ref'], allowed: ['citation', 'citation_verified', 'n', 'method'] },
  declared_intent: { required: ['declared_by'], allowed: [] },
};
const BASE_FIELDS = new Set(['class', 'summary']);
const ALL_CLASS_FIELDS = ['citation', 'citation_verified', 'n', 'method', 'experiment_ref', 'declared_by', 'rationale'];

export function checkEvidenceItem(item, path) {
  const errors = [];
  const spec = CLASS_FIELDS[item?.class];
  if (!spec) return errors; // the schema already reports an unknown class
  for (const field of spec.required) {
    if (item[field] === undefined) errors.push(`${path}: evidence class ${item.class} requires ${field}`);
  }
  for (const field of ALL_CLASS_FIELDS) {
    if (item[field] === undefined) continue;
    if (BASE_FIELDS.has(field) || spec.required.includes(field) || spec.allowed.includes(field)) continue;
    errors.push(`${path}: ${field} is not allowed on evidence class ${item.class}`);
  }
  if (item.class === 'documented_research' && item.citation_verified === true && !item.citation) {
    errors.push(`${path}: citation_verified true without a citation`);
  }
  return errors;
}

/**
 * The most confidence a set of evidence can support. Declared intent supports
 * confidence about WHAT THE OWNER INTENDS (profiles), never about an effect
 * (principles), so the caller says which it is asking.
 */
export function confidenceCap(evidence, { subject }) {
  const has = (cls, pred = () => true) => evidence.some((e) => e.class === cls && pred(e));
  if (has('validated_finding')) return 1;
  if (has('observed_behaviour')) return 0.85;
  if (has('documented_research', (e) => e.citation_verified === true)) return 0.8;
  if (subject === 'profile' && has('declared_intent')) return 0.9;
  if (has('documented_research')) return 0.6; // a citation no human has checked
  return 0.5; // hypothesis, or intent used as if it were evidence of effect
}

function checkConfidence(confidence, evidence, path, subject) {
  if (typeof confidence !== 'number' || !Array.isArray(evidence) || evidence.length === 0) return [];
  const cap = confidenceCap(evidence, { subject });
  return confidence > cap
    ? [`${path}: confidence ${confidence} exceeds ${cap}, the most its evidence classes support`]
    : [];
}

function checkEvidenceList(evidence, path, errors) {
  if (!Array.isArray(evidence)) return;
  evidence.forEach((item, i) => errors.push(...checkEvidenceItem(item, `${path}[${i}]`)));
}

/** Status/approver form rules shared by profiles and principles. */
export function checkStatus(doc, path = '$') {
  const errors = [];
  const { status, approver, ratified_at: ratifiedAt } = doc;
  if (status === 'ratified') {
    if (!approver) errors.push(`${path}.approver: a ratified document requires an approver`);
    if (!ratifiedAt) errors.push(`${path}.ratified_at: a ratified document requires ratified_at`);
  } else if (status === 'draft' || status === 'proposed') {
    if (approver) errors.push(`${path}.approver: a ${status} document must not name an approver (that is a claim of ratification)`);
    if (ratifiedAt) errors.push(`${path}.ratified_at: a ${status} document must not carry ratified_at`);
  }
  if (approver) {
    const asAi = (doc.contributors ?? []).find((c) => c.kind === 'ai' && c.id === approver.id);
    if (asAi) errors.push(`${path}.approver: ${approver.id} is an AI contributor; an AI session may propose but never ratify`);
  }
  const ids = (doc.contributors ?? []).map((c) => c.id);
  if (new Set(ids).size !== ids.length) errors.push(`${path}.contributors: ids must be unique`);
  return errors;
}

const TRANSITIONS = {
  draft: ['proposed', 'superseded'],
  proposed: ['draft', 'ratified', 'superseded'],
  ratified: ['superseded'],
  superseded: [],
};

/**
 * May `actor` move a document from one status to another? Ratification is the
 * one move only a human can make, and it cannot skip `proposed`.
 */
export function checkTransition(from, to, actor) {
  if (!STATUSES.includes(from) || !STATUSES.includes(to)) return { ok: false, reason: 'unknown status' };
  if (!TRANSITIONS[from].includes(to)) return { ok: false, reason: `${from} -> ${to} is not an allowed transition` };
  if (to === 'ratified') {
    if (!actor || actor.kind !== 'human' || !actor.id) return { ok: false, reason: 'only a human approver can ratify; an AI session may propose but never ratify' };
  }
  if (!actor || !actor.id || !['human', 'ai'].includes(actor.kind)) return { ok: false, reason: 'the actor must be identified as human or ai' };
  return { ok: true, reason: '' };
}

// A path in a source_ref names a file inside a checkout. Anything that could
// leave the checkout (or name a git internal) is refused at validation time,
// so the drift check never has to guess.
export function checkRelativePath(p) {
  if (typeof p !== 'string' || p === '') return 'must be a non-empty string';
  if (p.includes('\0') || p.includes('\\')) return 'must not contain NUL or backslash';
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return 'must be relative to the checkout root';
  const parts = p.split('/');
  if (parts.some((s) => s === '' || s === '.' || s === '..')) return 'must not contain empty, "." or ".." segments';
  if (parts[0] === '.git') return 'must not point into .git';
  return null;
}

function dupes(list) {
  const seen = new Set();
  const out = new Set();
  for (const x of list) { if (seen.has(x)) out.add(x); seen.add(x); }
  return [...out];
}

/**
 * Cross-field rules for a profile. `location` is where it was loaded from:
 *   'brain'   a file under Dot.Brain's brand/ directory (public repo)
 *   'product' a profile in a product repo, loaded from an arbitrary path
 */
export function checkProfile(profile, { location }) {
  const errors = [];
  errors.push(...checkStatus(profile));

  if (location === 'brain') {
    if (profile.kind === 'product') errors.push('$.kind: product profiles belong in their product repository, not in Dot.Brain');
    if (profile.classification !== 'public') errors.push('$.classification: Dot.Brain is public; only classification "public" may be stored here');
  } else if (location === 'product' && profile.kind !== 'product') {
    errors.push('$.kind: a profile loaded from a product checkout must have kind "product"');
  }

  if (profile.kind === 'ecosystem' && profile.extends) errors.push('$.extends: an ecosystem profile has no parent');
  if (profile.kind === 'product' && !profile.extends) errors.push('$.extends: a product profile must extend a brand or ecosystem profile');

  if (profile.extends) {
    const ref = parseIdVersion(profile.extends);
    if (ref && ref.id === profile.id) errors.push('$.extends: a profile cannot extend itself');
  }
  if (profile.supersedes) {
    const ref = parseIdVersion(profile.supersedes);
    if (ref && ref.id !== profile.id) errors.push('$.supersedes: must name an earlier version of the same profile id');
    else if (ref && compareSemver(ref.version, profile.version) >= 0) errors.push('$.supersedes: must name a version lower than this one');
  }

  if ((profile.status === 'draft' || profile.status === 'proposed') && Array.isArray(profile.unknowns) && profile.unknowns.length === 0) {
    errors.push('$.unknowns: a draft or proposed profile must record what it does not know');
  }

  // Evidence on every assertion, by class.
  for (const key of ['purpose', 'positioning']) {
    if (profile[key]) {
      checkEvidenceList(profile[key].evidence, `$.${key}.evidence`, errors);
      errors.push(...checkConfidence(profile[key].confidence, profile[key].evidence, `$.${key}.confidence`, 'profile'));
    }
  }
  if (profile.language?.voice) {
    checkEvidenceList(profile.language.voice.evidence, '$.language.voice.evidence', errors);
    errors.push(...checkConfidence(profile.language.voice.confidence, profile.language.voice.evidence, '$.language.voice.confidence', 'profile'));
  }
  (profile.audience ?? []).forEach((a, i) => {
    checkEvidenceList(a.evidence, `$.audience[${i}].evidence`, errors);
    if (a.identified === true && (!a.evidence || a.evidence.length === 0)) errors.push(`$.audience[${i}]: an identified audience segment requires evidence`);
    if (a.identified === false && a.evidence?.some((e) => e.class !== 'declared_intent')) errors.push(`$.audience[${i}]: an unidentified audience segment cannot carry evidence of anything but intent`);
  });
  (profile.emotional_promise ?? []).forEach((e, i) => {
    checkEvidenceList(e.evidence, `$.emotional_promise[${i}].evidence`, errors);
    errors.push(...checkConfidence(e.confidence, e.evidence, `$.emotional_promise[${i}].confidence`, 'profile'));
  });
  (profile.behavioural_principles ?? []).forEach((b, i) => {
    checkEvidenceList(b.evidence, `$.behavioural_principles[${i}].evidence`, errors);
    errors.push(...checkConfidence(b.confidence, b.evidence, `$.behavioural_principles[${i}].confidence`, 'profile'));
  });

  // Uniqueness.
  for (const [label, list] of [
    ['behavioural_principles', (profile.behavioural_principles ?? []).map((b) => b.id)],
    ['emotional_promise', (profile.emotional_promise ?? []).map((e) => e.feeling)],
    ['experience_standards', (profile.experience_standards ?? []).map((s) => s.principle)],
    ['language.claims_policy.forbidden', (profile.language?.claims_policy?.forbidden ?? []).map((f) => f.id)],
    ['unknowns', (profile.unknowns ?? []).map((u) => u.id)],
    ['overrides', (profile.overrides ?? []).map((o) => o.field)],
    ['domain_overrides', (profile.domain_overrides ?? []).map((d) => `${d.principle}|${d.yields_to}`)],
    ['visual_direction.source_refs', (profile.visual_direction?.source_refs ?? []).map((r) => `${r.repo}/${r.path}`)],
  ]) {
    for (const d of dupes(list)) errors.push(`$.${label}: duplicate entry ${d}`);
  }

  // Source refs must be safe, relative paths.
  (profile.visual_direction?.source_refs ?? []).forEach((r, i) => {
    const bad = checkRelativePath(r.path);
    if (bad) errors.push(`$.visual_direction.source_refs[${i}].path: ${bad}`);
  });

  // Standards.
  (profile.experience_standards ?? []).forEach((s, i) => {
    if ((s.stance === 'adapted' || s.stance === 'not_applicable') && !s.rationale) {
      errors.push(`$.experience_standards[${i}]: stance ${s.stance} requires a rationale`);
    }
    if (s.non_negotiable && (s.stance === 'not_applicable' || s.stance === 'adapted')) {
      errors.push(`$.experience_standards[${i}]: a non-negotiable standard must apply (stance applies or emphasised)`);
    }
  });

  return errors;
}

/** Cross-field rules for a framework principle. */
export function checkPrinciple(principle) {
  const errors = [];
  errors.push(...checkStatus(principle));

  checkEvidenceList(principle.evidence, '$.evidence', errors);
  errors.push(...checkConfidence(principle.confidence, principle.evidence, '$.confidence', 'principle'));

  const vm = principle.validation_method;
  if (vm && [vm.automated, vm.expert_review, vm.observed_behaviour, vm.customer_feedback].every((l) => !l || l.length === 0)) {
    errors.push('$.validation_method: at least one validation method is required');
  }

  if (principle.engagement_related === true) {
    if (!principle.dopemine_constraint) errors.push('$.dopemine_constraint: an engagement-related principle must state the Dopemine ethics constraint');
    else if (!principle.dopemine_constraint.includes('brain.dopemine.md')) errors.push('$.dopemine_constraint: must reference brain.dopemine.md');
    if (principle.requires_human_review !== true) errors.push('$.requires_human_review: must be true for an engagement-related principle');
  }

  if (principle.supersedes) {
    const ref = parseIdVersion(principle.supersedes);
    if (ref && ref.id !== principle.id) errors.push('$.supersedes: must name an earlier version of the same principle id');
    else if (ref && compareSemver(ref.version, principle.version) >= 0) errors.push('$.supersedes: must name a version lower than this one');
  }
  return errors;
}

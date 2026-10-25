// services/brand-engine/src/resolve.js
//
// `extends` resolution. A child profile inherits the SHARED parts of its
// parent (principle bindings, behavioural principles, prohibitions, the claims
// policy, visual constraints, cited sources, domain overrides, voice) and
// keeps its OWN identity parts (purpose, audience, positioning, emotional
// promise, unknowns). Merging is conservative by construction:
//
//   * Prohibitions only accumulate: a child can add to banned phrases,
//     prohibited visuals and the claims policy, never remove from them.
//   * Replacing an inherited value requires an entry in the child's
//     `overrides[]` with a reason; an override that replaces nothing is an
//     error, so the list stays an honest record.
//   * A non-negotiable inherited item cannot be overridden at all.
//   * Every merged item carries `origin` (profile id@version), so any
//     resolved rule traces back to the profile that set it.
import { compareSemver, parseIdVersion } from './semver.js';

export const MAX_DEPTH = 8;
export const MIN_REASON_LENGTH = 20;

const PARENT_KINDS = { product: ['brand', 'ecosystem'], brand: ['ecosystem'], ecosystem: [] };
const RANK = { draft: 0, proposed: 1, ratified: 2 };
const label = (p) => `${p.id}@${p.version}`;

function buildChain(profile, registry, errors) {
  const chain = [profile];
  const seen = new Set([profile.id]);
  let current = profile;
  while (current.extends) {
    const ref = parseIdVersion(current.extends);
    if (!ref) { errors.push(`${label(current)}: extends "${current.extends}" is not id@version`); return null; }
    if (seen.has(ref.id)) {
      errors.push(`extends cycle: ${[...chain.map((p) => p.id), ref.id].join(' -> ')}`);
      return null;
    }
    if (chain.length >= MAX_DEPTH) { errors.push(`extends chain deeper than ${MAX_DEPTH}`); return null; }
    const parent = registry.profiles.get(ref.id);
    if (!parent) { errors.push(`${label(current)} extends unknown profile ${ref.id}`); return null; }
    if (parent.version !== ref.version) {
      errors.push(`${label(current)} extends ${ref.id}@${ref.version}, but the registry holds ${ref.id}@${parent.version}`);
      return null;
    }
    chain.push(parent);
    seen.add(parent.id);
    current = parent;
  }
  // Kinds are checked only once the chain is known to terminate, so a cycle
  // is always reported as a cycle and not as a kind violation.
  for (let i = 0; i < chain.length - 1; i += 1) {
    if (!PARENT_KINDS[chain[i].kind]?.includes(chain[i + 1].kind)) {
      errors.push(`${label(chain[i])} (kind ${chain[i].kind}) cannot extend ${label(chain[i + 1])} (kind ${chain[i + 1].kind})`);
      return null;
    }
  }
  return chain;
}

/** Resolve `profile` against `registry`. Returns {resolved|null, errors, warnings}. */
export function resolveProfile(profile, registry) {
  const errors = [];
  const warnings = [];
  const chain = buildChain(profile, registry, errors);
  if (!chain) return { resolved: null, errors, warnings };

  const links = [...chain].reverse(); // root first
  const bp = new Map();
  const std = new Map();
  const refs = new Map();
  const constraints = new Map();
  const prohibited = new Map();
  const banned = new Map();
  const forbidden = new Map();
  const evidenceRequired = new Map();
  const dom = new Map();
  let voice = null;
  const applied = [];

  for (const link of links) {
    const who = label(link);
    const reasons = new Map();
    for (const o of link.overrides ?? []) {
      if (o.reason.trim().length < MIN_REASON_LENGTH) {
        errors.push(`${who}: override "${o.field}" needs a real reason (at least ${MIN_REASON_LENGTH} characters)`);
      }
      reasons.set(o.field, o.reason);
    }
    const used = new Set();
    const override = (field, detail, inheritedFrom) => {
      if (!reasons.has(field)) {
        errors.push(`${who}: ${detail} replaces a value inherited from ${inheritedFrom} but has no override entry for "${field}"`);
        return false;
      }
      used.add(field);
      applied.push({ field, by: who, replaces: inheritedFrom, reason: reasons.get(field) });
      return true;
    };

    for (const b of link.behavioural_principles) {
      const ex = bp.get(b.id);
      if (!ex) { bp.set(b.id, { ...b, origin: who }); continue; }
      if (ex.non_negotiable) {
        if (b.text !== ex.text || !b.non_negotiable) errors.push(`${who}: cannot override non-negotiable behavioural principle ${b.id} inherited from ${ex.origin}`);
        continue;
      }
      if (b.text !== ex.text && override(`behavioural_principles:${b.id}`, `behavioural principle ${b.id}`, ex.origin)) {
        bp.set(b.id, { ...b, origin: who });
      }
    }

    for (const s of link.experience_standards) {
      const ex = std.get(s.principle);
      if (!ex) {
        std.set(s.principle, {
          principle: s.principle, principle_version: s.principle_version, stance: s.stance,
          non_negotiable: s.non_negotiable, origin: who,
          expressions: [{ origin: who, text: s.expression }],
          rationales: s.rationale ? [{ origin: who, text: s.rationale }] : [],
        });
        continue;
      }
      if (ex.non_negotiable) {
        if (!s.non_negotiable) errors.push(`${who}: cannot relax non-negotiable standard ${s.principle} inherited from ${ex.origin}`);
        if (s.stance !== 'applies' && s.stance !== 'emphasised') errors.push(`${who}: cannot set stance ${s.stance} on non-negotiable standard ${s.principle} inherited from ${ex.origin}`);
      }
      if (s.stance !== ex.stance && !(ex.non_negotiable && s.stance !== 'applies' && s.stance !== 'emphasised')) {
        if (override(`experience_standards:${s.principle}`, `stance ${s.stance} for ${s.principle}`, ex.origin)) ex.stance = s.stance;
      }
      ex.non_negotiable = ex.non_negotiable || s.non_negotiable;
      ex.expressions.push({ origin: who, text: s.expression });
      if (s.rationale) ex.rationales.push({ origin: who, text: s.rationale });
      if (compareSemver(s.principle_version, ex.principle_version) > 0) ex.principle_version = s.principle_version;
    }

    for (const r of link.visual_direction.source_refs) {
      const key = `${r.repo}/${r.path}`;
      const ex = refs.get(key);
      if (!ex) { refs.set(key, { ...r, origin: who }); continue; }
      if ((ex.sha256 !== r.sha256 || ex.commit !== r.commit) && override(`visual_direction.source_refs:${key}`, `source ${key}`, ex.origin)) {
        refs.set(key, { ...r, origin: who });
      }
    }
    for (const t of link.visual_direction.constraints) if (!constraints.has(t)) constraints.set(t, who);
    for (const t of link.visual_direction.prohibited) if (!prohibited.has(t)) prohibited.set(t, who);
    for (const t of link.language.banned_phrases) if (!banned.has(t)) banned.set(t, who);
    for (const t of link.language.claims_policy.evidence_required) if (!evidenceRequired.has(t)) evidenceRequired.set(t, who);
    for (const f of link.language.claims_policy.forbidden) {
      const ex = forbidden.get(f.id);
      if (!ex) forbidden.set(f.id, { ...f, origin: who });
      else if (ex.rule !== f.rule) errors.push(`${who}: cannot redefine forbidden claim ${f.id} inherited from ${ex.origin}; add a new id instead`);
    }

    if (voice && voice.text !== link.language.voice.text) {
      if (override('language.voice', 'the voice', voice.origin)) voice = { text: link.language.voice.text, origin: who };
    } else if (!voice) {
      voice = { text: link.language.voice.text, origin: who };
    }

    for (const d of link.domain_overrides) {
      const key = `${d.principle}|${d.yields_to}`;
      if (!dom.has(key)) dom.set(key, { ...d, origin: who });
    }

    for (const field of reasons.keys()) {
      if (!used.has(field)) errors.push(`${who}: override "${field}" does not replace anything inherited`);
    }
  }

  // Status: a profile is only as ratified as everything it inherits from.
  const statuses = chain.map((p) => p.status);
  let effective;
  if (statuses.includes('superseded')) {
    effective = 'superseded';
    for (const p of chain) if (p.status === 'superseded') warnings.push(`${label(p)} is superseded`);
  } else {
    effective = statuses.reduce((low, s) => (RANK[s] < RANK[low] ? s : low), 'ratified');
  }
  for (const p of chain.slice(1)) {
    if (RANK[p.status] !== undefined && RANK[p.status] < RANK[profile.status]) {
      warnings.push(`${label(profile)} (${profile.status}) inherits from ${label(p)}, which is only ${p.status}`);
    }
  }

  if (errors.length) return { resolved: null, errors, warnings };

  const byKey = (k) => (a, b) => (a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0);
  const tag = (m) => [...m].map(([text, origin]) => ({ text, origin }));
  const resolved = {
    id: profile.id,
    kind: profile.kind,
    version: profile.version,
    status: profile.status,
    effective_status: effective,
    chain: chain.map(label),
    purpose: profile.purpose,
    audience: profile.audience,
    positioning: profile.positioning,
    emotional_promise: profile.emotional_promise,
    behavioural_principles: [...bp.values()].sort(byKey('id')),
    experience_standards: [...std.values()].sort(byKey('principle')),
    visual_direction: {
      source_refs: [...refs.values()].sort((a, b) => (`${a.repo}/${a.path}` < `${b.repo}/${b.path}` ? -1 : 1)),
      constraints: tag(constraints),
      prohibited: tag(prohibited),
    },
    language: {
      voice,
      banned_phrases: tag(banned),
      claims_policy: { forbidden: [...forbidden.values()].sort(byKey('id')), evidence_required: tag(evidenceRequired) },
    },
    domain_overrides: [...dom.values()].sort((a, b) => (`${a.principle}|${a.yields_to}` < `${b.principle}|${b.yields_to}` ? -1 : 1)),
    unknowns: chain.flatMap((p) => p.unknowns.map((u) => ({ ...u, origin: label(p) }))),
    overrides_applied: applied,
  };
  return { resolved, errors, warnings };
}

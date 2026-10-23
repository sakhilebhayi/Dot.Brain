// services/infodot-knowledge/src/decision.js
//
// Turns a scoring result into the record written to Dot.Memory (contract 2),
// and derives the idempotent event_id.
import { createHash } from 'node:crypto';
import { rationaleLines, resolveConfig } from './rules.js';

export const SUBJECT_TYPE = 'infodot-contribution';
export const SIGNATURE = 'knowledge-candidate';

const sha = (text, n) => createHash('sha256').update(text).digest('hex').slice(0, n);

/**
 * The inputs a person would call "the contribution": identity, topics,
 * corroboration, edit history. A change here is a MATERIAL change.
 */
export function materialInputs(item) {
  const norm = (v) => (v === undefined ? null : v);
  return {
    ref: item.contribution_ref,
    kind: norm(item.kind),
    topics: Array.isArray(item.topics) ? [...new Set(item.topics.filter((t) => typeof t === 'string'))].sort() : [],
    created_at: norm(item.created_at),
    edited_at: norm(item.edited_at),
    accepted_by_independent: item.accepted_by_independent === true,
    accepted_at: norm(item.accepted_at),
    verified_by_independent: item.verified_by_independent === true,
    verified_at: norm(item.verified_at),
    hidden: item.hidden === true,
    reversed: item.reversed === true,
  };
}

/**
 * Everything scoring reads. Popularity counts enter only as the number of
 * bonus steps that actually change confidence, so a count that has already
 * saturated its bound does not create a new decision each time it ticks up.
 * author_uuid and url are deliberately absent: scoring never reads them.
 */
export function inputsHash(item, config = {}) {
  const c = resolveConfig(config).confidence;
  const steps = (count, per, max) => (per > 0
    ? Math.min(Math.ceil(Number((max / per).toFixed(6))), Math.max(0, Math.floor(Number(count) || 0)))
    : 0);
  const payload = {
    ...materialInputs(item),
    helpful_steps: steps(item.helpful_count, c.helpful_per_vote, c.helpful_max),
    reuse_steps: steps(item.reuse_count, c.reuse_per_use, c.reuse_max),
  };
  return sha(JSON.stringify(payload), 32);
}

/**
 * kc:<material>:<rule_version>:<digest>
 *   material -- hash of the contribution's material inputs (no counts, no rule version)
 *   digest   -- hash of ref + rule_version + full inputs hash + verdict
 *
 * Same input and rules => same id (no new record). Changed input => new id.
 * The verdict is in the digest because it also depends on the clock: an
 * unchanged item that becomes "settled" tomorrow IS a new decision. The
 * `material` segment lets a later run recognise "this is the very contribution
 * a moderator declined, nothing about it has changed" without Brain storing
 * anything; the rule version is readable so past decisions can be graded per
 * version from the outcome rows alone.
 */
export function eventId(item, result, config = {}) {
  const material = sha(JSON.stringify(materialInputs(item)), 16);
  const digest = sha([item.contribution_ref, result.rule_version, inputsHash(item, config), result.verdict].join('|'), 24);
  return `kc:${material}:${result.rule_version}:${digest}`;
}

/** Parse the segments back out of an event_id this module produced. */
export function parseEventId(id) {
  const parts = typeof id === 'string' ? id.split(':') : [];
  return parts.length === 4 && parts[0] === 'kc'
    ? { material: parts[1], rule_version: parts[2] }
    : null;
}

/**
 * The Dot.Memory decision record. Flat, like services/intelligence/src/loop.js
 * (the shape Memory's decisions endpoint already validates), plus the
 * additive `verdict` and `evidence_refs` the intelligence-loop schema calls
 * for. Carries NO content, NO url, NO author, NO email: the only handle on
 * the contribution is its opaque reference.
 */
export function buildDecisionRecord(item, result, now, config = {}) {
  const ref = item.contribution_ref;
  const recommends = result.verdict === 'recommend_for_library';
  const lines = rationaleLines(result.rationale);

  return {
    loop_id: `knowledge-${sha(ref, 16)}`,
    event_id: eventId(item, result, config),
    platform: 'dot-brain',
    source: 'infodot-knowledge',
    subject_type: SUBJECT_TYPE,
    subject_id: ref,
    signature: SIGNATURE,
    occurred_at: new Date(now).toISOString(),
    evidence_refs: [ref],
    verdict: result.verdict,
    confidence: result.confidence,
    // Putting something in front of a moderator is reversible and costs one
    // look; the only thing at stake is moderator attention.
    risk: 0.1,
    // Brain RECOMMENDS; a moderator curates. It never climbs further.
    autonomy_level: recommends ? 'recommend' : 'observe',
    requires_approval: true,
    detail: {
      verdict: result.verdict,
      recommendation: recommends
        ? 'Consider for the Verified library.'
        : result.verdict === 'watch'
          ? 'Not yet: keep watching.'
          : 'Do not recommend for the Verified library.',
      rationale: lines,
      rationale_rules: result.rationale,
      rule_version: result.rule_version,
      inputs_hash: inputsHash(item, config),
    },
  };
}

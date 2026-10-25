// services/brand-engine/src/governance/lint.js
//
// The governance rules (ADR-0024). PURE over a parsed proposal and the current
// state of the brand data: no clock, no environment, no network.
//
//   * A proposal moves draft -> proposed -> ratified. Only a human reaches
//     ratified, and no command writes it: the owner edits the file in a
//     reviewed merge. This lint checks the FORM of that claim (who, when, in
//     what order); what makes it real is CODEOWNERS and the owner's merge.
//   * A proposal that asks for a change must say what, why, on what evidence,
//     for which products, how risky it is and how to undo it.
//   * Brand never outranks safety, regulation, accessibility, security or
//     functional correctness. A proposal cannot say otherwise.
//   * A ratified document is never edited silently: a change is a new version
//     with a changelog entry, and the ledger in brand/governance/changelog.json
//     pins the sha256 of every ratified version.
//
// Every finding has a stable `code` so a test can pin each refusal.
import { readJson } from '../json.js';
import { checkEvidenceItem, confidenceCap } from '../rules.js';
import { Refused } from '../score/constants.js';
import { loadRubric } from '../score/rubric.js';
import { scoreSchema } from '../score/schemas.js';
import { compareSemver, parseSemver } from '../semver.js';
import { join } from 'node:path';
import { listGovernedDocs, readTarget } from './targets.js';

const THIN = 20; // characters: below this a "rationale" is a label, not a reason
const PLACEHOLDER = /^\s*(todo|tbd|fixme|xxx|n\/a|none|\?+)(\b|$)/i;

/** 'major' | 'minor' | 'patch', or null when `to` is not greater than `from`. */
export function bumpKind(from, to) {
  const a = parseSemver(from);
  const b = parseSemver(to);
  if (!a || !b || compareSemver(from, to) >= 0) return null;
  if (b[0] > a[0]) return 'major';
  if (b[1] > a[1]) return 'minor';
  return 'patch';
}

const RUBRIC_BUMP = { dimension_set_weight_or_cap: 'major', checks_metrics_floors_policy: 'minor', wording: 'patch' };

function collector() {
  const errors = [];
  const warnings = [];
  return {
    errors, warnings,
    error: (code, path, message) => errors.push({ code, path, message }),
    warn: (code, path, message) => warnings.push({ code, path, message }),
  };
}

/**
 * Lint one proposal.
 * `asStatus`: judge it as if it had this status (used by `propose submit` to ask
 * "would this pass as proposed?" before writing it). Default: its own status.
 */
export function lintProposal(doc, { brandDir, asStatus } = {}) {
  const out = collector();
  const shape = scoreSchema('brand-proposal').validate(doc);
  if (shape.length) {
    for (const m of shape) out.error('schema', '$', m);
    return { ok: false, errors: out.errors, warnings: out.warnings };
  }

  const level = asStatus ?? doc.status;
  const strict = level !== 'draft';
  // Incomplete is a warning in a draft and a refusal from `proposed` on.
  const soft = (code, path, message) => (strict ? out.error(code, path, message) : out.warn(code, path, message));
  const { target, change } = doc;
  const humans = new Set();
  const ais = new Set();
  for (const c of [doc.author, ...(doc.contributors ?? [])]) (c.kind === 'ai' ? ais : humans).add(c.id);

  // ---------------------------------------------------------------- lifecycle
  const history = doc.history;
  if (history[0].status !== 'draft') out.error('history-start', '$.history[0]', 'the history must start with a draft');
  for (let i = 1; i < history.length; i += 1) {
    const prev = history[i - 1];
    const cur = history[i];
    const here = `$.history[${i}]`;
    if (Date.parse(cur.at) < Date.parse(prev.at)) out.error('history-order', here, 'history entries must not go back in time');
    if (cur.status === 'ratified' && cur.actor.kind !== 'human') {
      out.error('ai-ratification', here, `${cur.actor.id} is an AI actor; an AI session may propose but never ratify`);
      continue;
    }
    if (prev.status === 'ratified') { out.error('bad-transition', here, 'a ratified proposal is final'); continue; }
    const allowed = { draft: ['proposed'], proposed: ['draft', 'ratified'] }[prev.status] ?? [];
    if (!allowed.includes(cur.status)) out.error('bad-transition', here, `${prev.status} -> ${cur.status} is not an allowed transition (ratification only from proposed)`);
  }
  const last = history[history.length - 1];
  if (last.status !== doc.status) out.error('status-history-mismatch', '$.status', `status is ${doc.status} but the history ends at ${last.status}`);

  if (doc.status === 'ratified') {
    if (!doc.approver) out.error('approver-missing', '$.approver', 'a ratified proposal requires a human approver');
    if (!doc.ratified_at) out.error('ratified-at-missing', '$.ratified_at', 'a ratified proposal requires ratified_at');
    if (doc.approver) {
      if (doc.approver.kind !== 'human') out.error('ai-ratification', '$.approver', `${doc.approver.id} is not a human; an AI session may propose but never ratify`);
      else if (ais.has(doc.approver.id)) out.error('ai-ratification', '$.approver', `${doc.approver.id} is also listed as an AI contributor`);
      if (last.status === 'ratified' && last.actor.id !== doc.approver.id) out.error('approver-mismatch', '$.approver', 'the approver must be the actor of the ratifying history entry');
      if (doc.approver.id === doc.author.id) out.warn('self-ratified', '$.approver', 'the approver is also the author; the owner is the only ratifier, so this is recorded and not refused');
    }
    if (doc.ratified_at && last.status === 'ratified' && doc.ratified_at !== last.at) out.error('ratified-at-mismatch', '$.ratified_at', 'ratified_at must equal the time of the ratifying history entry');
  } else {
    if (doc.approver) out.error('premature-approver', '$.approver', `a ${doc.status} proposal must not name an approver (that is a claim of ratification)`);
    if (doc.ratified_at) out.error('premature-approver', '$.ratified_at', `a ${doc.status} proposal must not carry ratified_at`);
  }

  // ---------------------------------------------------------------- the target
  // A ratified proposal is a record of something already decided and applied, so its target has
  // since moved on; only a draft or a proposal is compared with the current state.
  const live = doc.status !== 'ratified';
  const state = readTarget(brandDir, target.kind, target.id);
  const isNew = target.change_kind === 'new';
  if (target.kind === 'doctrine' && target.id !== 'brain.brand_experience') out.error('unknown-target', '$.target.id', 'the only doctrine document is brain.brand_experience');
  if (target.kind === 'doctrine' && isNew) out.error('doctrine-new', '$.target.change_kind', 'there is one doctrine document; it is amended, not created');

  if (isNew) {
    if (target.from_version !== undefined || target.base_sha256 !== undefined) out.error('new-has-base', '$.target', 'a new document has no from_version and no base_sha256');
    if (target.edit_mode !== 'new_version') out.error('new-in-place', '$.target.edit_mode', 'a new document is a new version');
    if (live && state.exists) out.error('target-exists', '$.target.id', `${target.kind} ${target.id} already exists; propose an amendment`);
  } else {
    if (target.from_version === undefined) out.error('from-version-missing', '$.target.from_version', 'an amendment must name the version it amends');
    if (target.base_sha256 === undefined) soft('base-missing', '$.target.base_sha256', 'an amendment must record the sha256 of the document it was written against');
    if (live) {
      if (!state.exists) out.error('unknown-target', '$.target.id', `no ${target.kind} ${target.id} to amend`);
      else {
        if (target.from_version !== undefined && target.from_version !== state.version) out.error('version-mismatch', '$.target.from_version', `the document is at ${state.version}, not ${target.from_version}`);
        if (target.base_sha256 !== undefined && target.base_sha256 !== state.sha256) out.error('stale-base', '$.target.base_sha256', `the document changed since this proposal was written (now ${state.sha256}); rebase the proposal on the current version`);
      }
    }
  }

  if (target.edit_mode === 'in_place') {
    if (target.kind === 'rubric') out.error('silent-edit', '$.target.edit_mode', 'a released rubric is immutable; a change is a new version');
    if (target.from_version !== undefined && target.to_version !== target.from_version) out.error('in-place-version', '$.target.to_version', 'an in-place edit keeps the version; a change of version is a new version');
    if (live && state.exists && state.status === 'ratified') out.error('silent-edit', '$.target.edit_mode', `${target.kind} ${target.id} is ratified; it is never edited in place. Propose a new version with a changelog entry`);
  } else if (target.from_version !== undefined && compareSemver(target.to_version, target.from_version) <= 0) {
    out.error('version-not-increased', '$.target.to_version', `to_version ${target.to_version} must be higher than from_version ${target.from_version}`);
  }

  if (target.kind === 'rubric') {
    const type = change.rubric_change_type;
    if (!type) soft('rubric-change-type-missing', '$.change.rubric_change_type', 'a rubric proposal must say what kind of change it is: dimension_set_weight_or_cap (major), checks_metrics_floors_policy (minor) or wording (patch)');
    else if (target.from_version !== undefined && target.edit_mode === 'new_version') {
      const bump = bumpKind(target.from_version, target.to_version);
      if (bump !== RUBRIC_BUMP[type]) out.error('rubric-bump-mismatch', '$.target.to_version', `${type} is a ${RUBRIC_BUMP[type]} change, but ${target.from_version} -> ${target.to_version} is ${bump ? `a ${bump}` : 'not an'} bump`);
      if (type === 'dimension_set_weight_or_cap' && doc.risk.level !== 'high') soft('rubric-major-risk', '$.risk.level', 'a major rubric change makes old scores incomparable; its risk is high');
    }
    if (live && state.exists && state.versions?.includes(target.to_version)) out.error('rubric-version-exists', '$.target.to_version', `rubric ${target.id}@${target.to_version} is already released and immutable`);
  } else if (change.rubric_change_type !== undefined) {
    out.error('rubric-change-type-misplaced', '$.change.rubric_change_type', 'only a rubric proposal has a rubric_change_type');
  }

  const engagement = target.engagement_related === true || (live && state.exists && state.engagement_related === true);
  if (live && state.exists && target.engagement_related !== undefined && target.engagement_related !== state.engagement_related) {
    out.error('engagement-flag-mismatch', '$.target.engagement_related', `the target says engagement_related ${state.engagement_related}`);
  }
  if (engagement && doc.risk.ethics_review !== 'required') soft('ethics-review-required', '$.risk.ethics_review', 'a change to an engagement-related principle needs the ethics gate (brain.dopemine.md): set ethics_review to required');

  // ---------------------------------------------------------------- the changelog entry
  if (doc.changelog_entry.version !== target.to_version) out.error('changelog-version-mismatch', '$.changelog_entry.version', `the changelog entry is for ${doc.changelog_entry.version}, the proposal produces ${target.to_version}`);

  // ---------------------------------------------------------------- text
  const text = [
    ['$.title', doc.title], ['$.change.summary', change.summary], ['$.rationale', doc.rationale],
    ['$.risk.description', doc.risk.description], ['$.rollback', doc.rollback], ['$.changelog_entry.summary', doc.changelog_entry.summary],
    ...change.details.map((d, i) => [`$.change.details[${i}].after`, d.after]),
    ...doc.evidence.map((e, i) => [`$.evidence[${i}].summary`, e.summary]),
  ];
  for (const [path, value] of text) if (PLACEHOLDER.test(value)) soft('placeholder', path, `still a placeholder: "${value.slice(0, 40)}"`);
  for (const [path, value] of [['$.change.summary', change.summary], ['$.rationale', doc.rationale], ['$.risk.description', doc.risk.description], ['$.rollback', doc.rollback]]) {
    if (!PLACEHOLDER.test(value) && value.trim().length < THIN) soft('too-thin', path, `fewer than ${THIN} characters: say what and why, not a label`);
  }
  if (change.details.length === 0) soft('missing-change-details', '$.change.details', 'list what changes, field by field');

  // ---------------------------------------------------------------- evidence
  if (doc.evidence.length === 0) soft('missing-evidence', '$.evidence', 'a proposal needs evidence, each item with its class (documented_research, observed_behaviour, internal_hypothesis, validated_finding, declared_intent)');
  doc.evidence.forEach((item, i) => {
    const path = `$.evidence[${i}]`;
    for (const m of checkEvidenceItem(item, path)) out.error('evidence-class', path, m.replace(`${path}: `, ''));
    if (item.class === 'documented_research') {
      if (item.citation_verified !== true) {
        soft('unverified-citation', path, 'a citation no human has checked is not evidence a proposal can stand on: verify it, or drop it');
      } else if (!item.verified_by || !item.verified_at) {
        soft('verification-record-missing', path, 'citation_verified true needs verified_by (a human) and verified_at: who checked it, and when');
      } else if (item.verified_by.kind !== 'human' || ais.has(item.verified_by.id)) {
        out.error('ai-verified-citation', path, `${item.verified_by.id} is not a human; an AI session cannot verify a citation`);
      }
    } else if (item.verified_by !== undefined || item.verified_at !== undefined) {
      out.error('evidence-class', path, 'verified_by and verified_at belong to documented_research');
    }
  });
  if (doc.evidence.length > 0) {
    const cap = confidenceCap(doc.evidence, { subject: target.kind === 'principle' ? 'principle' : 'profile' });
    if (doc.confidence > cap) out.error('confidence-exceeds', '$.confidence', `confidence ${doc.confidence} exceeds ${cap}, the most the evidence classes support`);
  } else if (doc.confidence > 0.5) {
    soft('confidence-exceeds', '$.confidence', 'confidence above 0.5 with no evidence');
  }

  // ---------------------------------------------------------------- products, risk, rollback
  if (doc.affected_products.length === 0) soft('missing-affected-products', '$.affected_products', 'name the products this changes (or "ecosystem" for a change to every product)');

  // ---------------------------------------------------------------- precedence (always a refusal)
  if (change.weakens_precedence === true) out.error('weakens-precedence', '$.change.weakens_precedence', 'safety, regulation, accessibility, security and functional correctness always outrank brand; a proposal cannot weaken that');
  if (doc.precedence.acknowledged !== true) soft('precedence-not-acknowledged', '$.precedence.acknowledged', 'acknowledge that safety, regulation, accessibility, security and functional correctness outrank brand (ADR-0021 decision 8)');
  doc.precedence.conflicts.forEach((c, i) => {
    if (c.resolution !== 'brand_yields') out.error('brand-outranks-domain', `$.precedence.conflicts[${i}].resolution`, `a conflict with ${c.concern} resolves as brand_yields, never "${c.resolution}"`);
  });

  return { ok: out.errors.length === 0, errors: out.errors, warnings: out.warnings };
}

// ------------------------------------------------------------------------------------------------
// The ledger: ratified documents are pinned by hash, so none is edited silently.
// ------------------------------------------------------------------------------------------------

/**
 * Check brand/governance/changelog.json against the documents on disk.
 * Every ratified profile, principle or doctrine needs a `ratified` ledger entry for its exact
 * version and sha256, plus a created/amended entry for that version; a ratified version whose
 * file changed, was downgraded, was rolled back or was removed is refused; and every released
 * rubric must still match its pinned hash.
 */
export function checkGovernance(brandDir) {
  const out = collector();
  const read = readJson(join(brandDir, 'governance', 'changelog.json'), { followSymlinks: false });
  if (!read.ok) {
    out.error('changelog-file', 'governance/changelog.json', `cannot read the changelog and ledger: ${read.error}`);
    return { ok: false, errors: out.errors, warnings: out.warnings };
  }
  const shape = scoreSchema('brand-changelog').validate(read.value);
  if (shape.length) {
    for (const m of shape) out.error('schema', 'governance/changelog.json', m);
    return { ok: false, errors: out.errors, warnings: out.warnings };
  }
  const entries = read.value.entries;

  // ---- the entries themselves
  const seen = new Set();
  const lastVersion = new Map();
  entries.forEach((e, i) => {
    const path = `entries[${i}]`;
    const key = `${e.doc}|${e.version}|${e.kind}`;
    if (seen.has(key)) out.error('changelog-duplicate', path, `duplicate ${e.kind} entry for ${e.doc}@${e.version}`);
    seen.add(key);
    const before = lastVersion.get(e.doc);
    if (before && compareSemver(e.version, before) < 0) out.error('changelog-order', path, `${e.doc}: version ${e.version} comes after ${before}; entries are in version order`);
    lastVersion.set(e.doc, e.version);
    if (e.kind === 'ratified') {
      if (!e.approver) out.error('approver-missing', path, 'a ratified entry names its human approver');
      else if (e.approver.kind !== 'human') out.error('ai-ratification', path, `${e.approver.id} is not a human; an AI session may propose but never ratify`);
      else if (e.author.kind === 'ai' && e.author.id === e.approver.id) out.error('ai-ratification', path, `${e.approver.id} is listed as the AI author`);
      if (!e.sha256) out.error('ledger-hash-missing', path, 'a ratified entry pins the sha256 of the version it ratified');
    } else if (e.approver || e.sha256) {
      out.error('changelog-claim', path, `only a ratified entry carries an approver or a sha256 (this one is ${e.kind})`);
    }
  });

  // ---- the documents on disk against the ledger
  const docs = listGovernedDocs(brandDir);
  const byDoc = new Map();
  for (const e of entries) {
    if (!byDoc.has(e.doc)) byDoc.set(e.doc, []);
    byDoc.get(e.doc).push(e);
  }
  for (const [doc, disk] of docs) {
    const mine = byDoc.get(doc) ?? [];
    const ratifiedHere = mine.filter((e) => e.kind === 'ratified' && e.version === disk.version);
    if (disk.status === 'ratified') {
      if (!ratifiedHere.length) {
        out.error('ledger-missing', doc, `${doc}@${disk.version} is ratified but has no ratified entry in the ledger. A ratified file is pinned by its sha256 (${disk.sha256}), added by the owner in a reviewed merge`);
      } else if (ratifiedHere.every((e) => e.sha256 !== disk.sha256)) {
        out.error('silent-edit', doc, `${doc}@${disk.version} is ratified and its content no longer matches the ledger (recorded ${ratifiedHere[ratifiedHere.length - 1].sha256}, actual ${disk.sha256}). A ratified document is never edited in place: a change is a new version with a changelog entry`);
      }
      if (!mine.some((e) => e.version === disk.version && (e.kind === 'created' || e.kind === 'amended'))) {
        out.error('changelog-missing', doc, `${doc}@${disk.version} has no created or amended changelog entry`);
      }
    } else if (ratifiedHere.length) {
      out.error('silent-edit', doc, `${doc}@${disk.version} is ratified in the ledger but its status is now ${disk.status}: a ratified document is superseded by a new version, never downgraded`);
    }
    const ledger = mine.filter((e) => e.kind === 'ratified');
    const newest = ledger.reduce((a, e) => (!a || compareSemver(e.version, a.version) > 0 ? e : a), null);
    if (newest && compareSemver(disk.version, newest.version) < 0) {
      out.error('silent-edit', doc, `${doc} is at ${disk.version}, below its ratified ${newest.version}: a ratified version was rolled back`);
    }
  }
  for (const [doc, mine] of byDoc) {
    if (docs.has(doc)) continue;
    const newest = mine[mine.length - 1];
    if (mine.some((e) => e.kind === 'ratified') && newest.kind !== 'superseded') {
      out.error('ratified-file-removed', doc, `${doc} has a ratified ledger entry and no file on disk; a ratified document is superseded by a new version, never deleted`);
    }
  }

  // ---- released rubrics keep their pinned hash
  const released = readJson(join(brandDir, 'rubrics', 'released.json'), { followSymlinks: false });
  if (released.ok && released.value?.released) {
    for (const [id, versions] of Object.entries(released.value.released)) {
      for (const version of Object.keys(versions)) {
        try { loadRubric(brandDir, `${id}-${version}`); } catch (error) {
          if (!(error instanceof Refused)) throw error;
          out.error('silent-edit', `rubric:${id}@${version}`, error.message.split('\n')[0]);
        }
      }
    }
  }
  return { ok: out.errors.length === 0, errors: out.errors, warnings: out.warnings };
}

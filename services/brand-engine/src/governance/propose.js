// services/brand-engine/src/governance/propose.js
//
// Writing proposals. This file can create a draft and move a draft to
// `proposed`, and nothing else. It never produces the final status of the
// lifecycle: that step belongs to a human owner, who edits the file in a
// reviewed merge, and a test reads this source to prove the word is absent.
import { lintProposal } from './lint.js';
import { readTarget } from './targets.js';
import { parseSemver } from '../semver.js';

export class ProposeError extends Error {
  constructor(message, { findings = [], refused = false } = {}) {
    super(message);
    this.name = 'ProposeError';
    this.findings = findings;
    this.refused = refused;
  }
}

const slugOf = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

const nextPatch = (v) => {
  const [a, b, c] = parseSemver(v);
  return `${a}.${b}.${c + 1}`;
};

/**
 * A skeleton draft for a change to `kind:id`, filled from the target's CURRENT state (its version,
 * its sha256, whether it is engagement-related). Text fields hold "TODO" placeholders: the skeleton
 * is a valid draft and fails the `proposed` bar until a person has written the real content.
 */
export function initProposal({ brandDir, kind, id, isNew = false, author, createdAt, slug }) {
  const state = readTarget(brandDir, kind, id);
  if (isNew) {
    if (state.exists) throw new ProposeError(`${kind} ${id} already exists; propose an amendment (omit --new)`);
  } else if (!state.exists) {
    throw new ProposeError(`no ${kind} ${id} to amend (use --new to propose a new one)`);
  }
  const day = createdAt.slice(0, 10);
  const proposalSlug = slugOf(slug ?? `${kind}-${id}`);
  if (proposalSlug.length < 3) throw new ProposeError('--slug must give at least three letters or digits');
  const toVersion = isNew ? '0.1.0' : nextPatch(state.version);
  const doc = {
    format: 'brand-proposal/1',
    id: `BRP-${day}-${proposalSlug}`,
    title: `TODO: a one-line title for the change to ${kind} ${id}`,
    status: 'draft',
    target: {
      kind, id, change_kind: isNew ? 'new' : 'amend', edit_mode: 'new_version', to_version: toVersion,
      ...(isNew ? {} : { from_version: state.version, base_sha256: state.sha256 }),
      ...(state.engagement_related === true ? { engagement_related: true } : {}),
    },
    change: { summary: 'TODO: what changes', details: [], weakens_precedence: false },
    rationale: 'TODO: why it should change',
    evidence: [],
    confidence: 0,
    affected_products: [],
    risk: { level: 'medium', description: 'TODO: what could go wrong', ethics_review: state.engagement_related === true ? 'required' : 'not_needed' },
    rollback: 'TODO: how to undo it',
    precedence: { acknowledged: false, conflicts: [] },
    changelog_entry: { version: toVersion, date: createdAt, summary: 'TODO: the changelog line' },
    author: { id: author.id, kind: author.kind, display_name: author.display_name },
    created_at: createdAt,
    history: [{ status: 'draft', at: createdAt, actor: { id: author.id, kind: author.kind } }],
  };
  return doc;
}

/**
 * Move a draft to `proposed`. The proposal must pass the lint AS a proposal first; if it does not,
 * nothing is returned and the findings explain why. Anyone, human or AI, may do this: it is the
 * furthest an AI session or the engine can take a proposal.
 */
export function submitProposal(doc, { brandDir, actor, at }) {
  if (doc?.status === 'proposed') throw new ProposeError('this proposal is already proposed');
  if (doc?.status !== 'draft') throw new ProposeError('only a draft can be submitted; a proposal past `proposed` is never touched by a command', { refused: true });
  const last = doc.history?.[doc.history.length - 1];
  if (last && Date.parse(at) < Date.parse(last.at)) throw new ProposeError(`--at ${at} is before the last history entry (${last.at})`);
  const candidate = {
    ...doc,
    status: 'proposed',
    history: [...doc.history, { status: 'proposed', at, actor: { id: actor.id, kind: actor.kind } }],
  };
  const result = lintProposal(candidate, { brandDir });
  if (!result.ok) throw new ProposeError('the proposal does not pass the lint as a proposal; nothing was written', { findings: result.errors });
  return { doc: candidate, warnings: result.warnings };
}

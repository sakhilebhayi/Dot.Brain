// Every refusal of the proposal lint, one test each, plus the proposals it accepts.
// All proposals here are TEST FIXTURES; none is a real proposal and none ratifies anything real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bumpKind } from '../src/governance/lint.js';
import { readTarget } from '../src/governance/targets.js';
import {
  AI, BRAND, OWNER, T0, T1, T2, clone, codes, copyRepo, goodProposal, lint, mergeDeep, ratifiedProposal, ratifyProfileOnDisk, readJsonFile, warnCodes, writeJson,
} from './_gov_helpers.js';

const refuses = (doc, code, opts) => {
  const r = lint(doc, opts);
  assert.ok(codes(r).includes(code), `expected ${code}, got ${JSON.stringify(r.errors)}`);
  assert.equal(r.ok, false);
  return r;
};

// ------------------------------------------------------------------ what passes

test('a complete proposal passes with no findings', () => {
  const r = lint(goodProposal());
  assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
});

test('a proposal that an AI wrote and a human owner ratified passes (the AI drafted, the human decided)', () => {
  const r = lint(ratifiedProposal());
  assert.deepEqual(codes(r), []);
  assert.equal(r.ok, true);
});

test('a ratified proposal is a record, so it is not compared with the target as it is today', () => {
  const doc = ratifiedProposal({ target: { base_sha256: 'f'.repeat(64), from_version: '0.0.9' } });
  assert.equal(lint(doc).ok, true);
});

test('a draft with unfinished text is allowed, with a warning for each gap', () => {
  const doc = goodProposal({ status: 'draft', history: [{ status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } }], evidence: [], affected_products: [], rationale: 'TODO: why', precedence: { acknowledged: false, conflicts: [] } });
  const r = lint(doc);
  assert.equal(r.ok, true);
  assert.deepEqual([...new Set(warnCodes(r))].sort(), ['confidence-exceeds', 'missing-affected-products', 'missing-evidence', 'placeholder', 'precedence-not-acknowledged']);
});

test('the same gaps are refusals once the proposal is proposed', () => {
  const doc = goodProposal({ evidence: [], affected_products: [], rationale: 'TODO: why', precedence: { acknowledged: false } });
  const r = lint(doc);
  assert.deepEqual([...new Set(codes(r))].sort(), ['confidence-exceeds', 'missing-affected-products', 'missing-evidence', 'placeholder', 'precedence-not-acknowledged']);
});

test('asStatus judges a draft as a proposal (what `propose submit` asks)', () => {
  const draft = goodProposal({ status: 'draft', history: [{ status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } }], rationale: 'TODO: why' });
  assert.equal(lint(draft).ok, true);
  assert.equal(lint(draft, { asStatus: 'proposed' }).ok, false);
});

test('bumpKind names the size of a version change, or null when it is not an increase', () => {
  assert.equal(bumpKind('1.2.3', '2.0.0'), 'major');
  assert.equal(bumpKind('1.2.3', '1.3.0'), 'minor');
  assert.equal(bumpKind('1.2.3', '1.2.4'), 'patch');
  assert.equal(bumpKind('1.2.3', '1.2.3'), null);
  assert.equal(bumpKind('1.2.3', '1.2.2'), null);
});

// ------------------------------------------------------------------ shape

test('refuses a document that does not match the schema, naming what is wrong', () => {
  const noRollback = goodProposal();
  delete noRollback.rollback;
  assert.match(refuses(noRollback, 'schema').errors[0].message, /rollback: is required/);
  refuses(goodProposal({ status: 'approved' }), 'schema');
  refuses(goodProposal({ format: 'brand-proposal/2' }), 'schema');
  refuses(goodProposal({ surprise: 1 }), 'schema');
  refuses(goodProposal({ target: { kind: 'logo' } }), 'schema');
  assert.equal(lint(goodProposal({ 'x-note': 'extension fields are ignored' })).ok, true);
});

// ------------------------------------------------------------------ the lifecycle: only a human ratifies

test('refuses a ratification by an AI actor', () => {
  const doc = ratifiedProposal();
  doc.history[2].actor = { id: AI.id, kind: 'ai' };
  doc.approver = { id: AI.id, kind: 'ai' };
  const r = refuses(doc, 'ai-ratification');
  assert.ok(r.errors.filter((e) => e.code === 'ai-ratification').length >= 2, 'both the history entry and the approver are refused');
});

test('refuses an approver who is not marked human, even if the history says a human acted', () => {
  refuses(ratifiedProposal({ approver: { id: OWNER.id, kind: 'ai' } }), 'ai-ratification');
});

test('refuses an approver who is also listed as an AI contributor', () => {
  refuses(ratifiedProposal({ contributors: [{ id: OWNER.id, kind: 'ai', display_name: 'Fixture' }] }), 'ai-ratification');
});

test('refuses an AI-authored proposal that ratifies itself (the author is the approver and an AI)', () => {
  const doc = ratifiedProposal({ approver: { id: AI.id, kind: 'human' } });
  doc.history[2].actor = { id: AI.id, kind: 'human' };
  refuses(doc, 'ai-ratification');
});

test('refuses a ratified status with no human history entry at all (a status edited by hand)', () => {
  const doc = goodProposal({ status: 'ratified', approver: { id: OWNER.id, kind: 'human' }, ratified_at: T2 });
  const r = lint(doc);
  assert.ok(codes(r).includes('status-history-mismatch'));
});

test('refuses ratification that skips `proposed`', () => {
  const doc = ratifiedProposal();
  doc.history.splice(1, 1);
  refuses(doc, 'bad-transition');
});

test('refuses any move after ratification', () => {
  const doc = ratifiedProposal();
  doc.history.push({ status: 'proposed', at: '2026-10-25T09:00:00Z', actor: { id: AI.id, kind: 'ai' } });
  doc.status = 'proposed';
  delete doc.approver;
  delete doc.ratified_at;
  refuses(doc, 'bad-transition');
});

test('refuses a history that does not start at draft, goes back in time, or ends somewhere other than the status', () => {
  refuses(goodProposal({ history: [{ status: 'proposed', at: T0, actor: { id: AI.id, kind: 'ai' } }] }), 'history-start');
  const back = goodProposal();
  back.history[1].at = '2026-10-01T00:00:00Z';
  refuses(back, 'history-order');
  refuses(goodProposal({ status: 'draft' }), 'status-history-mismatch');
});

test('refuses a ratified proposal with no approver, no ratified_at, a different approver, or a different time', () => {
  const noApprover = ratifiedProposal();
  delete noApprover.approver;
  refuses(noApprover, 'approver-missing');
  const noAt = ratifiedProposal();
  delete noAt.ratified_at;
  refuses(noAt, 'ratified-at-missing');
  refuses(ratifiedProposal({ approver: { id: 'someone-else', kind: 'human' } }), 'approver-mismatch');
  refuses(ratifiedProposal({ ratified_at: '2026-10-30T09:00:00Z' }), 'ratified-at-mismatch');
});

test('refuses an approver or ratified_at on a proposal that is not ratified', () => {
  refuses(goodProposal({ approver: { id: OWNER.id, kind: 'human' } }), 'premature-approver');
  refuses(goodProposal({ ratified_at: T2 }), 'premature-approver');
});

test('records, and does not refuse, the owner approving a proposal the owner wrote', () => {
  const doc = ratifiedProposal({ author: { id: OWNER.id, kind: 'human', display_name: OWNER.display_name } });
  const r = lint(doc);
  assert.equal(r.ok, true);
  assert.ok(warnCodes(r).includes('self-ratified'));
});

// ------------------------------------------------------------------ the target

test('refuses an amendment to a document that does not exist', () => {
  refuses(goodProposal({ target: { id: 'no-such-profile' } }), 'unknown-target');
  refuses(goodProposal({ target: { kind: 'principle', id: 'BXP-99' } }), 'unknown-target');
  refuses(goodProposal({ target: { kind: 'rubric', id: 'nope' } }), 'unknown-target');
  refuses(goodProposal({ target: { kind: 'doctrine', id: 'brain.other' } }), 'unknown-target');
});

test('refuses a new document that already exists, carries a base, or is edited in place', () => {
  const fresh = (over) => goodProposal({ target: { change_kind: 'new', to_version: '0.1.0', from_version: undefined, base_sha256: undefined, ...over }, changelog_entry: { version: '0.1.0' } });
  assert.equal(lint(fresh({ id: 'brand-new' })).ok, true);
  refuses(fresh({ id: 'infodot' }), 'target-exists');
  refuses(fresh({ id: 'brand-new', from_version: '0.1.0' }), 'new-has-base');
  refuses(fresh({ id: 'brand-new', base_sha256: 'a'.repeat(64) }), 'new-has-base');
  refuses(fresh({ id: 'brand-new', edit_mode: 'in_place' }), 'new-in-place');
  refuses(fresh({ kind: 'doctrine', id: 'brain.brand_experience' }), 'doctrine-new');
});

test('refuses an amendment that does not say which version it amends', () => {
  refuses(goodProposal({ target: { from_version: undefined } }), 'from-version-missing');
});

test('requires the base hash from a proposal, and only warns about its absence in a draft', () => {
  refuses(goodProposal({ target: { base_sha256: undefined } }), 'base-missing');
  const draft = goodProposal({ status: 'draft', history: [{ status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } }], target: { base_sha256: undefined } });
  assert.ok(warnCodes(lint(draft)).includes('base-missing'));
});

test('refuses a proposal written against a version that is not the current one', () => {
  refuses(goodProposal({ target: { from_version: '0.0.9' } }), 'version-mismatch');
});

test('refuses a stale base: the target changed after the proposal was written', () => {
  const r = refuses(goodProposal({ target: { base_sha256: 'b'.repeat(64) } }), 'stale-base');
  assert.match(r.errors.find((e) => e.code === 'stale-base').message, /changed since this proposal was written/);
});

test('a stale base is caught after any edit to the file, however small', () => {
  const dir = copyRepo();
  const doc = goodProposal({}, dir);
  assert.equal(lint(doc, { brandDir: dir }).ok, true);
  const path = join(dir, 'profiles', 'infodot.profile.json');
  const profile = readJsonFile(path);
  profile.language.voice.text += ' ';
  writeJson(path, profile);
  refuses(doc, 'stale-base', { brandDir: dir });
});

test('refuses to edit a ratified document in place: that is a silent edit', () => {
  const dir = copyRepo();
  ratifyProfileOnDisk(dir);
  const doc = goodProposal({ target: { edit_mode: 'in_place', to_version: '0.1.0' }, changelog_entry: { version: '0.1.0' } }, dir);
  const r = refuses(doc, 'silent-edit', { brandDir: dir });
  assert.match(r.errors.find((e) => e.code === 'silent-edit').message, /never edited in place/);
  // The same change as a new version is fine.
  assert.equal(lint(goodProposal({}, dir), { brandDir: dir }).ok, true);
});

test('allows an in-place edit of a document that is not ratified, but not a change of version', () => {
  const inPlace = goodProposal({ target: { edit_mode: 'in_place', to_version: '0.1.0' }, changelog_entry: { version: '0.1.0' } });
  inPlace.target.to_version = inPlace.target.from_version;
  inPlace.changelog_entry.version = inPlace.target.from_version;
  assert.equal(lint(inPlace).ok, true);
  refuses(goodProposal({ target: { edit_mode: 'in_place' } }), 'in-place-version');
});

test('refuses a new version that does not increase the version', () => {
  const current = readTarget(BRAND, 'profile', 'infodot').version;
  refuses(goodProposal({ target: { to_version: current }, changelog_entry: { version: current } }), 'version-not-increased');
  refuses(goodProposal({ target: { to_version: '0.0.1' }, changelog_entry: { version: '0.0.1' } }), 'version-not-increased');
});

test('refuses a changelog entry for a different version than the one the proposal produces', () => {
  refuses(goodProposal({ changelog_entry: { version: '9.9.9' } }), 'changelog-version-mismatch');
});

// ------------------------------------------------------------------ the rubric

const rubricProposal = (over = {}) => mergeDeep(goodProposal({
  target: { kind: 'rubric', id: 'bxqs', from_version: '1.0.0', to_version: '1.0.1', base_sha256: readTarget(BRAND, 'rubric', 'bxqs').sha256 },
  change: { rubric_change_type: 'wording', summary: 'Reword the anchor for level 3 of the trust dimension so it is easier to apply.', details: [{ field: 'dimensions[5].anchors[3]', after: 'clearer wording' }] },
  changelog_entry: { version: '1.0.1' },
}), over);

test('accepts a rubric proposal whose change type matches the version bump', () => {
  assert.equal(lint(rubricProposal()).ok, true);
  assert.equal(lint(rubricProposal({ target: { to_version: '1.1.0' }, change: { rubric_change_type: 'checks_metrics_floors_policy' }, changelog_entry: { version: '1.1.0' } })).ok, true);
  assert.equal(lint(rubricProposal({ target: { to_version: '2.0.0' }, change: { rubric_change_type: 'dimension_set_weight_or_cap' }, risk: { level: 'high' }, changelog_entry: { version: '2.0.0' } })).ok, true);
});

test('refuses a rubric proposal with no change type, a mismatched bump, a low-risk major change, or a misplaced type', () => {
  refuses(rubricProposal({ change: { rubric_change_type: undefined } }), 'rubric-change-type-missing');
  refuses(rubricProposal({ target: { to_version: '1.1.0' }, changelog_entry: { version: '1.1.0' } }), 'rubric-bump-mismatch');
  refuses(rubricProposal({ target: { to_version: '2.0.0' }, change: { rubric_change_type: 'wording' }, changelog_entry: { version: '2.0.0' } }), 'rubric-bump-mismatch');
  refuses(rubricProposal({ target: { to_version: '2.0.0' }, change: { rubric_change_type: 'dimension_set_weight_or_cap' }, changelog_entry: { version: '2.0.0' } }), 'rubric-major-risk');
  refuses(goodProposal({ change: { rubric_change_type: 'wording' } }), 'rubric-change-type-misplaced');
});

test('refuses to edit a released rubric in place or to re-release a version', () => {
  refuses(rubricProposal({ target: { edit_mode: 'in_place', to_version: '1.0.0' }, changelog_entry: { version: '1.0.0' } }), 'silent-edit');
  refuses(rubricProposal({ target: { to_version: '1.0.0' }, changelog_entry: { version: '1.0.0' } }), 'version-not-increased');
  const dir = copyRepo();
  const released = join(dir, 'rubrics', 'released.json');
  const ledger = readJsonFile(released);
  ledger.released.bxqs['1.0.1'] = { sha256: 'c'.repeat(64), released_at: T0 };
  writeJson(released, ledger);
  refuses(rubricProposal({ target: { base_sha256: readTarget(dir, 'rubric', 'bxqs').sha256, from_version: '1.0.1', to_version: '1.0.1' } }), 'version-not-increased', { brandDir: dir });
  const from100 = rubricProposal();
  from100.target.from_version = '1.0.0';
  refuses(from100, 'rubric-version-exists', { brandDir: dir });
});

test('the doctrine can be amended like any other governed document', () => {
  const dir = copyRepo();
  const state = readTarget(dir, 'doctrine', 'brain.brand_experience');
  assert.equal(state.exists, true);
  const [a, b, c] = state.version.split('.').map(Number);
  const next = `${a}.${b}.${c + 1}`;
  const doc = goodProposal({ target: { kind: 'doctrine', id: 'brain.brand_experience', from_version: state.version, to_version: next, base_sha256: state.sha256 }, changelog_entry: { version: next } }, dir);
  assert.equal(lint(doc, { brandDir: dir }).ok, true);
  refuses({ ...doc, target: { ...doc.target, base_sha256: 'd'.repeat(64) } }, 'stale-base', { brandDir: dir });
});

// ------------------------------------------------------------------ engagement

test('an engagement-related principle needs the ethics gate, and the flag must match the target', () => {
  const state = readTarget(BRAND, 'principle', 'BXP-09');
  assert.equal(state.engagement_related, true);
  const doc = (over = {}) => mergeDeep(goodProposal({
    target: { kind: 'principle', id: 'BXP-09', from_version: state.version, base_sha256: state.sha256, engagement_related: true, to_version: '0.1.1' },
    evidence: [{ class: 'declared_intent', summary: 'The owner asked for this wording change.', declared_by: 'fixture-owner' }],
    confidence: 0.5, risk: { level: 'medium', ethics_review: 'required' },
  }), over);
  assert.equal(lint(doc()).ok, true, JSON.stringify(lint(doc()).errors));
  refuses(doc({ risk: { ethics_review: 'not_needed' } }), 'ethics-review-required');
  refuses(doc({ target: { engagement_related: false } }), 'engagement-flag-mismatch');
  const unflagged = doc();
  delete unflagged.target.engagement_related;
  unflagged.risk.ethics_review = 'not_needed';
  refuses(unflagged, 'ethics-review-required');
});

// ------------------------------------------------------------------ text

test('refuses placeholder and label-only text', () => {
  for (const [path, value] of [['title', 'TODO: title'], ['rationale', 'TBD'], ['rollback', 'n/a'], ['change', 'TODO']]) {
    const doc = path === 'change' ? goodProposal({ change: { summary: value } }) : goodProposal({ [path]: value });
    refuses(doc, 'placeholder');
  }
  refuses(goodProposal({ evidence: [{ class: 'declared_intent', summary: 'TODO', declared_by: 'fixture-owner' }], confidence: 0.5 }), 'placeholder');
  refuses(goodProposal({ rationale: 'Because.' }), 'too-thin');
  refuses(goodProposal({ rollback: 'Revert it.' }), 'too-thin');
  refuses(goodProposal({ risk: { description: 'Low.' } }), 'too-thin');
  refuses(goodProposal({ change: { details: [] } }), 'missing-change-details');
});

// ------------------------------------------------------------------ evidence

test('refuses a proposal with no evidence', () => {
  refuses(goodProposal({ evidence: [], confidence: 0.3 }), 'missing-evidence');
});

test('refuses evidence that carries the wrong fields for its class', () => {
  refuses(goodProposal({ evidence: [{ class: 'observed_behaviour', summary: 'People liked it.' }], confidence: 0.5 }), 'evidence-class');
  refuses(goodProposal({ evidence: [{ class: 'declared_intent', summary: 'The owner asked.', declared_by: 'fixture-owner', n: 40 }], confidence: 0.5 }), 'evidence-class');
  refuses(goodProposal({ evidence: [{ class: 'internal_hypothesis', summary: 'We think so.', rationale: 'A hunch.', verified_by: { id: OWNER.id, kind: 'human' } }], confidence: 0.4 }), 'evidence-class');
  refuses(goodProposal({ evidence: [{ class: 'validated_finding', summary: 'It worked.' }], confidence: 0.5 }), 'evidence-class');
});

test('refuses an unverified citation: a citation no human has checked is not evidence to stand on', () => {
  const unverified = { class: 'documented_research', summary: 'A fixture reference.', citation: 'Fixture Author (2020)', citation_verified: false };
  const r = refuses(goodProposal({ evidence: [unverified], confidence: 0.5 }), 'unverified-citation');
  assert.match(r.errors.find((e) => e.code === 'unverified-citation').message, /no human has checked/);
  const omitted = { ...unverified };
  delete omitted.citation_verified;
  refuses(goodProposal({ evidence: [omitted], confidence: 0.5 }), 'evidence-class');
});

test('a verified citation needs a record of who verified it and when', () => {
  const claimed = { class: 'documented_research', summary: 'A fixture reference.', citation: 'Fixture Author (2020)', citation_verified: true };
  refuses(goodProposal({ evidence: [claimed], confidence: 0.5 }), 'verification-record-missing');
  refuses(goodProposal({ evidence: [{ ...claimed, verified_by: { id: OWNER.id, kind: 'human' } }], confidence: 0.5 }), 'verification-record-missing');
});

test('refuses a citation "verified" by an AI', () => {
  const claimed = { class: 'documented_research', summary: 'A fixture reference.', citation: 'Fixture Author (2020)', citation_verified: true, verified_at: T1 };
  refuses(goodProposal({ evidence: [{ ...claimed, verified_by: { id: 'other-ai', kind: 'ai' } }], confidence: 0.5 }), 'ai-verified-citation');
  refuses(goodProposal({ evidence: [{ ...claimed, verified_by: { id: AI.id, kind: 'human' } }], confidence: 0.5 }), 'ai-verified-citation');
});

test('refuses confidence the evidence classes do not support', () => {
  refuses(goodProposal({ confidence: 0.95 }), 'confidence-exceeds');
  refuses(goodProposal({ evidence: [{ class: 'internal_hypothesis', summary: 'We think so.', rationale: 'A fixture hunch.' }], confidence: 0.6 }), 'confidence-exceeds');
  refuses(goodProposal({ evidence: [], confidence: 0.9 }), 'confidence-exceeds');
});

// ------------------------------------------------------------------ products, risk, rollback

test('refuses a proposal that names no affected product', () => {
  refuses(goodProposal({ affected_products: [] }), 'missing-affected-products');
  refuses(goodProposal({ affected_products: ['Dot Memory'] }), 'schema');
  refuses(goodProposal({ affected_products: ['infodot', 'infodot'] }), 'schema');
  assert.equal(lint(goodProposal({ affected_products: ['ecosystem'] })).ok, true);
});

// ------------------------------------------------------------------ precedence

test('refuses a proposal that weakens the precedence rule', () => {
  const r = refuses(goodProposal({ change: { weakens_precedence: true } }), 'weakens-precedence');
  assert.match(r.errors.find((e) => e.code === 'weakens-precedence').message, /always outrank brand/);
});

test('refuses a proposal that does not acknowledge the precedence rule', () => {
  refuses(goodProposal({ precedence: { acknowledged: false } }), 'precedence-not-acknowledged');
});

test('refuses a conflict that brand wins, and accepts one that brand yields', () => {
  for (const concern of ['safety', 'regulation', 'accessibility', 'security', 'functional_correctness']) {
    refuses(goodProposal({ precedence: { conflicts: [{ concern, description: 'A fixture conflict.', resolution: 'brand_outranks' }] } }), 'brand-outranks-domain');
    assert.equal(lint(goodProposal({ precedence: { conflicts: [{ concern, description: 'A fixture conflict.', resolution: 'brand_yields' }] } })).ok, true, concern);
  }
});

test('precedence refusals hold even in a draft', () => {
  const draft = { status: 'draft', history: [{ status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } }] };
  refuses(goodProposal({ ...draft, change: { weakens_precedence: true } }), 'weakens-precedence');
  refuses(goodProposal({ ...draft, precedence: { conflicts: [{ concern: 'security', description: 'A fixture conflict.', resolution: 'brand_outranks' }] } }), 'brand-outranks-domain');
  refuses(goodProposal({ ...draft, evidence: [{ class: 'documented_research', summary: 'x fixture', citation: 'c', citation_verified: true, verified_by: { id: 'ai-2', kind: 'ai' }, verified_at: T1 }] }), 'ai-verified-citation');
});

// ------------------------------------------------------------------ purity

test('lint does not change the proposal it is given', () => {
  const doc = goodProposal();
  const before = JSON.stringify(doc);
  lint(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(JSON.stringify(clone(doc)), before);
});

test('the shipped proposals directory (if any) lints clean', () => {
  const dir = join(BRAND, 'proposals');
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.proposal.json'))) {
    const r = lint(JSON.parse(readFileSync(join(dir, name), 'utf8')));
    assert.deepEqual(r.errors, [], name);
  }
});

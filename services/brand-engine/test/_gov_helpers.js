// Helpers for the governance tests. Everything built here is a TEST FIXTURE: no real proposal,
// no real approver, no real ratification.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintProposal } from '../src/governance/lint.js';
import { readTarget } from '../src/governance/targets.js';
import { canonicalHash } from '../src/score/util.js';
import { BRAND, ROOT, clone, readJsonFile, runCli, writeJson } from './_helpers.js';

export { BRAND, ROOT, clone, readJsonFile, runCli, writeJson };

const AI = { id: 'fixture-ai', kind: 'ai', display_name: 'Fixture AI author' };
const OWNER = { id: 'fixture-owner', kind: 'human', display_name: 'Fixture Owner' };
export { AI, OWNER };

export const T0 = '2026-10-23T12:00:00Z';
export const T1 = '2026-10-23T13:00:00Z';
export const T2 = '2026-10-24T09:00:00Z';

export const tmpDir = (prefix = 'gov-') => mkdtempSync(join(tmpdir(), prefix));

/** A private copy of the repository layout the governance code reads: <tmp>/brand and the doctrine file. Returns the brand dir. */
export function copyRepo() {
  const root = tmpDir('gov-repo-');
  cpSync(BRAND, join(root, 'brand'), { recursive: true });
  cpSync(join(ROOT, 'brain.brand_experience.md'), join(root, 'brain.brand_experience.md'));
  return join(root, 'brand');
}

/** A valid proposal (status `proposed`) amending the shipped `infodot` profile. */
export function goodProposal(over = {}, brandDir = BRAND) {
  const state = readTarget(brandDir, 'profile', 'infodot');
  const doc = {
    format: 'brand-proposal/1',
    id: 'BRP-2026-10-23-infodot-voice-note',
    title: 'Record that plain words beat jargon in the InfoDot voice',
    status: 'proposed',
    target: { kind: 'profile', id: 'infodot', change_kind: 'amend', edit_mode: 'new_version', from_version: state.version, to_version: '0.1.1', base_sha256: state.sha256 },
    change: {
      summary: 'Add one line to the InfoDot voice guidance saying plain words are preferred over jargon.',
      details: [{ field: '$.language.voice.text', before: 'current voice summary', after: 'current voice summary, plus: prefer plain words over jargon' }],
      weakens_precedence: false,
    },
    rationale: 'The owner asked for plainer language in the InfoDot copy, and the copy lint already flags jargon the profile does not name.',
    evidence: [
      { class: 'declared_intent', summary: 'The owner asked for plain language in a session note.', declared_by: 'fixture-owner' },
      { class: 'documented_research', summary: 'A fixture reference, checked by the owner.', citation: 'Fixture Author (2020), a fixture article', citation_verified: true, verified_by: { id: 'fixture-owner', kind: 'human' }, verified_at: T1 },
    ],
    confidence: 0.7,
    affected_products: ['infodot'],
    risk: { level: 'low', description: 'Copy guidance only; no product behaviour or score changes.', ethics_review: 'not_needed' },
    rollback: 'Revert the one added line and the version bump; nothing downstream reads it yet.',
    precedence: { acknowledged: true, conflicts: [] },
    changelog_entry: { version: '0.1.1', date: T0, summary: 'InfoDot voice: prefer plain words over jargon.' },
    author: AI,
    contributors: [],
    created_at: T0,
    history: [
      { status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } },
      { status: 'proposed', at: T1, actor: { id: AI.id, kind: 'ai' } },
    ],
  };
  return mergeDeep(doc, over);
}

/** The same proposal after the OWNER ratified it (written by hand, as the owner would in a reviewed merge). */
export function ratifiedProposal(over = {}, brandDir = BRAND) {
  const doc = goodProposal({}, brandDir);
  doc.status = 'ratified';
  doc.history.push({ status: 'ratified', at: T2, actor: { id: OWNER.id, kind: 'human' } });
  doc.approver = { id: OWNER.id, kind: 'human', display_name: OWNER.display_name };
  doc.ratified_at = T2;
  return mergeDeep(doc, over);
}

/** Shallow-per-key merge where an `undefined` value deletes the key and arrays/primitives replace. */
export function mergeDeep(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete out[k];
    else if (v !== null && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = mergeDeep(out[k], v);
    else out[k] = v;
  }
  return out;
}

export const lint = (doc, opts = {}) => lintProposal(doc, { brandDir: BRAND, ...opts });
export const codes = (result) => result.errors.map((e) => e.code);
export const warnCodes = (result) => result.warnings.map((e) => e.code);

/** Make a profile in a copied brand dir ratified (the shape of a ratified document, by hand). Returns its canonical hash. */
export function ratifyProfileOnDisk(brandDir, id = 'infodot') {
  const path = join(brandDir, 'profiles', `${id}.profile.json`);
  const doc = readJsonFile(path);
  doc.status = 'ratified';
  doc.approver = { id: OWNER.id, kind: 'human', display_name: OWNER.display_name };
  doc.ratified_at = T2;
  writeJson(path, doc);
  return { path, doc, sha256: canonicalHash(doc) };
}

export function writeChangelog(brandDir, entries) {
  writeJson(join(brandDir, 'governance', 'changelog.json'), { format: 'brand-changelog/1', entries });
}

export const entry = (over = {}) => ({
  doc: 'profile:infodot', version: '0.1.0', date: T0, kind: 'created', summary: 'Fixture entry.', author: { id: AI.id, kind: 'ai' }, ...over,
});
export const ratifiedEntry = (sha256, over = {}) => entry({ kind: 'ratified', date: T2, summary: 'Fixture ratification.', approver: { id: OWNER.id, kind: 'human' }, sha256, ...over });

export const read = (path) => readFileSync(path, 'utf8');
export { mkdirSync, writeFileSync };

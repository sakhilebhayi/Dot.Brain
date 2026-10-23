// The ratification ledger: a ratified document is pinned by hash, so it cannot be edited silently.
// Every "ratified" document below is a TEST FIXTURE in a temporary copy of brand/; nothing real is ratified.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { checkGovernance } from '../src/governance/lint.js';
import { listGovernedDocs } from '../src/governance/targets.js';
import { BRAND, OWNER, copyRepo, entry, ratifiedEntry, ratifyProfileOnDisk, readJsonFile, writeChangelog, writeJson } from './_gov_helpers.js';

const codesOf = (r) => r.errors.map((e) => e.code);
const refuses = (dir, code) => {
  const r = checkGovernance(dir);
  assert.ok(codesOf(r).includes(code), `expected ${code}, got ${JSON.stringify(r.errors)}`);
  assert.equal(r.ok, false);
  return r;
};

test('the shipped brand/ has an empty ledger and nothing ratified, and checks clean', () => {
  const r = checkGovernance(BRAND);
  assert.deepEqual(r, { ok: true, errors: [], warnings: [] });
  assert.deepEqual(readJsonFile(join(BRAND, 'governance', 'changelog.json')), { format: 'brand-changelog/1', entries: [] });
  for (const [doc, d] of listGovernedDocs(BRAND)) assert.notEqual(d.status, 'ratified', `${doc} must not be ratified by an AI session`);
});

test('a ratified document with a matching ledger entry passes', () => {
  const dir = copyRepo();
  const { sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  assert.deepEqual(checkGovernance(dir), { ok: true, errors: [], warnings: [] });
});

test('refuses a ratified document that has no ledger entry, and tells the owner the hash to record', () => {
  const dir = copyRepo();
  const { sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry()]);
  const r = refuses(dir, 'ledger-missing');
  assert.match(r.errors.find((e) => e.code === 'ledger-missing').message, new RegExp(sha256));
});

test('refuses a ratified document with no created or amended changelog entry', () => {
  const dir = copyRepo();
  const { sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [ratifiedEntry(sha256)]);
  refuses(dir, 'changelog-missing');
});

test('refuses a silent edit: a ratified file whose content changed after it was ratified', () => {
  const dir = copyRepo();
  const { path, doc, sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  assert.equal(checkGovernance(dir).ok, true);
  doc.purpose.text += ' (quietly improved)';
  writeJson(path, doc);
  const r = refuses(dir, 'silent-edit');
  assert.match(r.errors.find((e) => e.code === 'silent-edit').message, /never edited in place/);
});

test('refuses a silent edit that keeps the formatting and changes one character, and ignores a pure reformat', () => {
  const dir = copyRepo();
  const { path, doc, sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  writeJson(path, JSON.parse(JSON.stringify(doc)));
  assert.equal(checkGovernance(dir).ok, true, 'key order and whitespace do not change the canonical hash');
  doc.version = '0.1.0';
  doc.positioning.text = `${doc.positioning.text}.`;
  writeJson(path, doc);
  refuses(dir, 'silent-edit');
});

test('refuses a ratified document quietly set back to a lower status', () => {
  const dir = copyRepo();
  const { path, doc, sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  doc.status = 'draft';
  delete doc.approver;
  delete doc.ratified_at;
  writeJson(path, doc);
  refuses(dir, 'silent-edit');
});

test('refuses a ratified version that was rolled back to an older version', () => {
  const dir = copyRepo();
  ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry('e'.repeat(64), { version: '9.0.0' }), entry({ version: '9.0.0', kind: 'amended' })]);
  const r = refuses(dir, 'silent-edit');
  assert.match(r.errors.find((e) => e.code === 'silent-edit').message, /rolled back/);
});

test('refuses a ratified document that was deleted without being superseded, and accepts a supersession entry', () => {
  const dir = copyRepo();
  const { path, sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  rmSync(path);
  refuses(dir, 'ratified-file-removed');
  writeChangelog(dir, [entry(), ratifiedEntry(sha256), entry({ kind: 'superseded', date: '2026-10-25T09:00:00Z', summary: 'Replaced by a successor.' })]);
  assert.equal(checkGovernance(dir).ok, true);
});

test('a new version of a ratified document needs its own entries, and the old pin still stands for the old version', () => {
  const dir = copyRepo();
  const { path, doc, sha256 } = ratifyProfileOnDisk(dir);
  const next = { ...doc, version: '0.2.0', status: 'proposed' };
  delete next.approver;
  delete next.ratified_at;
  writeJson(path, next);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256), entry({ version: '0.2.0', kind: 'amended', date: '2026-10-26T09:00:00Z' })]);
  assert.equal(checkGovernance(dir).ok, true, JSON.stringify(checkGovernance(dir).errors));
});

test('refuses a modified released rubric as a silent edit', () => {
  const dir = copyRepo();
  const path = join(dir, 'rubrics', 'bxqs-1.0.0.json');
  const rubric = readJsonFile(path);
  rubric.description += ' ';
  writeJson(path, rubric);
  const r = refuses(dir, 'silent-edit');
  assert.match(r.errors[0].path, /rubric:bxqs@1.0.0/);
});

test('refuses an unreadable or invalid changelog', () => {
  const dir = copyRepo();
  rmSync(join(dir, 'governance', 'changelog.json'));
  refuses(dir, 'changelog-file');
  writeJson(join(dir, 'governance', 'changelog.json'), { format: 'brand-changelog/2', entries: [] });
  refuses(dir, 'schema');
  writeJson(join(dir, 'governance', 'changelog.json'), { format: 'brand-changelog/1', entries: [{ doc: 'logo:x', version: '1', date: 'x', kind: 'sold', summary: '', author: {} }] });
  refuses(dir, 'schema');
});

test('refuses duplicate entries and entries out of version order', () => {
  const dir = copyRepo();
  writeChangelog(dir, [entry(), entry()]);
  refuses(dir, 'changelog-duplicate');
  writeChangelog(dir, [entry({ version: '0.2.0', kind: 'amended' }), entry({ version: '0.1.0', kind: 'amended' })]);
  refuses(dir, 'changelog-order');
});

test('refuses a ratified entry with an AI approver, no approver, or no hash', () => {
  const dir = copyRepo();
  writeChangelog(dir, [ratifiedEntry('a'.repeat(64), { approver: { id: 'fixture-ai', kind: 'ai' } })]);
  refuses(dir, 'ai-ratification');
  writeChangelog(dir, [ratifiedEntry('a'.repeat(64), { approver: { id: 'fixture-ai', kind: 'human' }, author: { id: 'fixture-ai', kind: 'ai' } })]);
  refuses(dir, 'ai-ratification');
  const noApprover = ratifiedEntry('a'.repeat(64));
  delete noApprover.approver;
  writeChangelog(dir, [noApprover]);
  refuses(dir, 'approver-missing');
  const noHash = ratifiedEntry('a'.repeat(64));
  delete noHash.sha256;
  writeChangelog(dir, [noHash]);
  refuses(dir, 'ledger-hash-missing');
});

test('refuses an approver or a hash on an entry that is not a ratification', () => {
  const dir = copyRepo();
  writeChangelog(dir, [entry({ sha256: 'a'.repeat(64) })]);
  refuses(dir, 'changelog-claim');
  writeChangelog(dir, [entry({ approver: { id: OWNER.id, kind: 'human' } })]);
  refuses(dir, 'changelog-claim');
});

test('the check is read-only: it changes nothing in brand/', () => {
  const dir = copyRepo();
  const { sha256 } = ratifyProfileOnDisk(dir);
  writeChangelog(dir, [entry(), ratifiedEntry(sha256)]);
  const before = JSON.stringify([...listGovernedDocs(dir)]);
  checkGovernance(dir);
  assert.equal(JSON.stringify([...listGovernedDocs(dir)]), before);
});

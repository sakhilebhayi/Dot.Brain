// propose and lint-proposal as a subprocess: exit codes, what is written, and the one thing no command can do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../src/main.js';
import { GOVERNANCE_USAGE } from '../src/governance/cli.js';
import { AI, BRAND, ROOT, T0, T1, copyRepo, goodProposal, ratifiedProposal, readJsonFile, runCli, tmpDir, writeJson } from './_gov_helpers.js';

const INIT = (out, extra = []) => ['propose', 'init', '--target', 'profile:infodot', '--author-id', AI.id, '--author-kind', 'ai', '--author-name', AI.display_name, '--created-at', T0, '-o', out, ...extra];
const SUBMIT = (file, out, extra = []) => ['propose', 'submit', file, '--actor-id', AI.id, '--actor-kind', 'ai', '--at', T1, ...(out ? ['-o', out] : []), ...extra];

/** A draft that is finished: the skeleton with every TODO replaced, as a person or an AI session would. */
function finishedDraft(dir) {
  const skeleton = join(dir, 'skeleton.json');
  assert.equal(runCli(INIT(skeleton)).code, 0);
  const doc = readJsonFile(skeleton);
  const good = goodProposal();
  const finished = { ...good, id: doc.id, status: 'draft', history: doc.history, target: doc.target, changelog_entry: { ...good.changelog_entry, version: doc.target.to_version }, created_at: doc.created_at };
  const path = join(dir, 'draft.json');
  writeJson(path, finished);
  return path;
}

test('propose init writes a draft skeleton from the target\'s current state, and never overwrites a file', () => {
  const dir = tmpDir();
  const out = join(dir, 'p.json');
  const r = runCli(INIT(out));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /draft BRP-2026-10-23-profile-infodot \(profile infodot 0\.1\.0 -> 0\.1\.1\)/);
  const doc = readJsonFile(out);
  assert.equal(doc.status, 'draft');
  assert.deepEqual(doc.history, [{ status: 'draft', at: T0, actor: { id: AI.id, kind: 'ai' } }]);
  assert.equal(doc.target.from_version, '0.1.0');
  assert.match(doc.target.base_sha256, /^[0-9a-f]{64}$/);
  assert.equal(doc.approver, undefined);
  assert.match(doc.rationale, /^TODO/);
  const again = runCli(INIT(out));
  assert.equal(again.code, 2);
  assert.match(again.stderr, /never overwrites/);
});

test('propose init marks an engagement-related principle for the ethics gate and records the flag', () => {
  const out = join(tmpDir(), 'p.json');
  assert.equal(runCli(['propose', 'init', '--target', 'principle:BXP-09', '--author-id', AI.id, '--author-kind', 'ai', '--author-name', 'A', '--created-at', T0, '-o', out]).code, 0);
  const doc = readJsonFile(out);
  assert.equal(doc.target.engagement_related, true);
  assert.equal(doc.risk.ethics_review, 'required');
});

test('propose init prints the draft on stdout when no -o is given, byte for byte the same each time', () => {
  const args = ['propose', 'init', '--target', 'profile:blupin', '--author-id', AI.id, '--author-kind', 'ai', '--author-name', 'A', '--created-at', T0];
  const a = runCli(args);
  const b = runCli(args);
  assert.equal(a.code, 0);
  assert.equal(a.stdout, b.stdout);
  assert.equal(JSON.parse(a.stdout).target.id, 'blupin');
});

test('propose init for a new document needs --new, and refuses --new for one that exists', () => {
  const base = ['propose', 'init', '--author-id', AI.id, '--author-kind', 'ai', '--author-name', 'A', '--created-at', T0];
  const fresh = runCli([...base, '--target', 'profile:brand-new', '--new']);
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(JSON.parse(fresh.stdout).target.change_kind, 'new');
  assert.equal(runCli([...base, '--target', 'profile:brand-new']).code, 2);
  const dup = runCli([...base, '--target', 'profile:infodot', '--new']);
  assert.equal(dup.code, 2);
  assert.match(dup.stderr, /already exists/);
});

test('usage errors are exit 2 and print the usage', () => {
  const ok = ['--author-id', AI.id, '--author-kind', 'ai', '--author-name', 'A', '--created-at', T0];
  const cases = [
    ['propose'], ['propose', 'nope'], ['propose', 'init'], ['propose', 'init', '--target', 'profile:infodot'],
    ['propose', 'init', '--target', 'logo:x', ...ok], ['propose', 'init', '--target', 'infodot', ...ok],
    ['propose', 'init', '--target', 'profile:infodot', '--author-id', 'a', '--author-kind', 'robot', '--author-name', 'A', '--created-at', T0],
    ['propose', 'init', '--target', 'profile:infodot', '--author-id', 'a', '--author-kind', 'ai', '--author-name', 'A', '--created-at', 'yesterday'],
    ['propose', 'init', '--target', 'profile:infodot', ...ok, '--nope', 'x'], ['propose', 'init', '--target', 'profile:infodot', ...ok, 'stray'],
    ['propose', 'init', '--target', 'profile:infodot', '--target', 'profile:blupin', ...ok], ['propose', 'init', '--target'],
    ['propose', 'init', '--target', 'profile:infodot', ...ok, '--new', '--new'],
    ['propose', 'submit'], ['propose', 'submit', 'a.json', 'b.json'], ['propose', 'submit', 'a.json'],
    ['propose', 'submit', 'a.json', '--actor-id', 'a', '--actor-kind', 'robot', '--at', T1], ['propose', 'submit', 'a.json', '--actor-id', 'a', '--actor-kind', 'ai', '--at', 'soon'],
    ['lint-proposal'], ['lint-proposal', '--check-ratified', 'a.json'], ['lint-proposal', '--nope'], ['lint-proposal', '--json', '--json', 'a.json'],
  ];
  for (const argv of cases) {
    const r = runCli(argv);
    assert.equal(r.code, 2, `${argv.join(' ')} -> ${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes('usage: brand-engine'), argv.join(' '));
  }
});

test('lint-proposal reads a missing, oversized or malformed file as invalid input, never as clean', () => {
  const dir = tmpDir();
  assert.equal(runCli(['lint-proposal', join(dir, 'missing.json')]).code, 2);
  writeFileSync(join(dir, 'bad.json'), '{ not json');
  const bad = runCli(['lint-proposal', join(dir, 'bad.json')]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /invalid JSON/);
  writeFileSync(join(dir, 'array.json'), '[]');
  assert.equal(runCli(['lint-proposal', join(dir, 'array.json')]).code, 1, 'valid JSON of the wrong shape is a lint refusal');
});

test('an AI session can take a finished draft to `proposed` and no further', () => {
  const dir = tmpDir();
  const draft = finishedDraft(dir);
  const out = join(dir, 'proposed.json');
  const r = runCli(SUBMIT(draft, out));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /is now proposed \(by ai fixture-ai\)/);
  assert.match(r.stdout, /Ratification is the owner's/);
  const doc = readJsonFile(out);
  assert.equal(doc.status, 'proposed');
  assert.equal(doc.approver, undefined);
  assert.equal(doc.ratified_at, undefined);
  assert.deepEqual(doc.history.map((h) => [h.status, h.actor.kind]), [['draft', 'ai'], ['proposed', 'ai']]);
  const lint = runCli(['lint-proposal', out]);
  assert.equal(lint.code, 0, lint.stdout);
  assert.match(lint.stdout, /: ok \(status proposed\): 0 error\(s\), 0 warning\(s\)/);
});

test('nothing on the command line can set `ratified`: not a status flag, not an approver flag, not a human actor', () => {
  const dir = tmpDir();
  const draft = finishedDraft(dir);
  for (const extra of [['--status', 'ratified'], ['--approver', 'owner'], ['--ratify'], ['--ratified-at', T1]]) {
    const r = runCli(SUBMIT(draft, join(dir, 'x.json'), extra));
    assert.equal(r.code, 2, extra.join(' '));
    assert.match(r.stderr, /unknown argument/);
  }
  // Even a human actor only reaches `proposed`: the owner edits the file in a reviewed merge.
  const human = runCli(['propose', 'submit', draft, '--actor-id', 'fixture-owner', '--actor-kind', 'human', '--at', T1]);
  assert.equal(human.code, 0, human.stderr);
  const doc = JSON.parse(human.stdout);
  assert.equal(doc.status, 'proposed');
  assert.equal(doc.approver, undefined);
  assert.ok(!readFileSync(join(ROOT, 'services/brand-engine/src/governance/propose.js'), 'utf8').toLowerCase().includes('ratif'));
});

test('propose submit refuses a proposal that is already proposed (exit 2) or ratified (exit 3), and touches nothing', () => {
  const dir = tmpDir();
  const proposed = join(dir, 'proposed.json');
  writeJson(proposed, goodProposal());
  const again = runCli(SUBMIT(proposed, join(dir, 'out.json')));
  assert.equal(again.code, 2);
  assert.match(again.stderr, /already proposed/);

  const ratified = join(dir, 'ratified.json');
  writeJson(ratified, ratifiedProposal());
  const before = readFileSync(ratified, 'utf8');
  const r = runCli(SUBMIT(ratified, ratified));
  assert.equal(r.code, 3);
  assert.match(r.stderr, /never touched by a command/);
  assert.equal(readFileSync(ratified, 'utf8'), before);
  assert.ok(!existsSync(join(dir, 'out.json')));
});

test('propose submit writes nothing when the lint refuses, and prints every finding (exit 1)', () => {
  const dir = tmpDir();
  const skeleton = join(dir, 'skeleton.json');
  assert.equal(runCli(INIT(skeleton)).code, 0);
  const before = readFileSync(skeleton, 'utf8');
  const out = join(dir, 'out.json');
  const r = runCli(SUBMIT(skeleton, out));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /does not pass the lint as a proposal; nothing was written/);
  for (const code of ['placeholder', 'missing-evidence', 'missing-affected-products', 'precedence-not-acknowledged']) assert.match(r.stderr, new RegExp(`\\[${code}\\]`));
  assert.ok(!existsSync(out));
  assert.equal(readFileSync(skeleton, 'utf8'), before);
});

test('propose submit refuses a time before the last history entry, and refuses to overwrite a file that is not its input', () => {
  const dir = tmpDir();
  const draft = finishedDraft(dir);
  const early = runCli(['propose', 'submit', draft, '--actor-id', AI.id, '--actor-kind', 'ai', '--at', '2026-01-01T00:00:00Z']);
  assert.equal(early.code, 2);
  assert.match(early.stderr, /before the last history entry/);
  const other = join(dir, 'other.json');
  writeFileSync(other, '{}');
  const r = runCli(SUBMIT(draft, other));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /only replaces the file it was given/);
  assert.equal(readFileSync(other, 'utf8'), '{}');
  assert.equal(runCli(SUBMIT(draft, draft)).code, 0, 'replacing its own input is allowed');
  assert.equal(readJsonFile(draft).status, 'proposed');
});

test('propose submit refuses a stale draft: the target moved on after it was started', () => {
  const brandDir = copyRepo();
  const dir = tmpDir();
  const out = join(dir, 'p.json');
  assert.equal(runCli(INIT(out, ['--brand-dir', brandDir])).code, 0);
  const path = join(brandDir, 'profiles', 'infodot.profile.json');
  const profile = readJsonFile(path);
  profile.language.voice.text += ' changed';
  writeJson(path, profile);
  const draftDoc = readJsonFile(out);
  const good = goodProposal({}, BRAND);
  writeJson(out, { ...good, id: draftDoc.id, status: 'draft', history: draftDoc.history, target: draftDoc.target, changelog_entry: { ...good.changelog_entry, version: draftDoc.target.to_version } });
  const r = runCli(SUBMIT(out, join(dir, 'o.json'), ['--brand-dir', brandDir]));
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\[stale-base\]/);
});

test('lint-proposal prints each finding with its code and path, as text or as JSON, and exits 1 on a refusal', () => {
  const dir = tmpDir();
  const bad = join(dir, 'bad.json');
  writeJson(bad, goodProposal({ change: { weakens_precedence: true }, rollback: 'Revert it.' }));
  const good = join(dir, 'good.json');
  writeJson(good, goodProposal());
  const text = runCli(['lint-proposal', good, bad]);
  assert.equal(text.code, 1);
  assert.match(text.stdout, /good\.json: ok \(status proposed\)/);
  assert.match(text.stdout, /bad\.json: refused \(status proposed\): 2 error\(s\)/);
  assert.match(text.stdout, /error \[weakens-precedence\] \$\.change\.weakens_precedence/);
  assert.match(text.stdout, /error \[too-thin\] \$\.rollback/);
  const j = JSON.parse(runCli(['lint-proposal', '--json', good, bad]).stdout);
  assert.deepEqual(j.files.map((f) => f.ok), [true, false]);
  assert.deepEqual(j.files[1].errors.map((e) => e.code).sort(), ['too-thin', 'weakens-precedence']);
  assert.equal(runCli(['lint-proposal', good]).code, 0);
});

test('lint-proposal --check-ratified exits 0 on the shipped data and 1 on a silent edit', () => {
  assert.equal(runCli(['lint-proposal', '--check-ratified']).code, 0);
  const brandDir = copyRepo();
  const rubric = join(brandDir, 'rubrics', 'bxqs-1.0.0.json');
  const doc = readJsonFile(rubric);
  doc.description += ' ';
  writeJson(rubric, doc);
  const r = runCli(['lint-proposal', '--check-ratified', '--brand-dir', brandDir]);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\[silent-edit\] rubric:bxqs@1\.0\.0/);
  assert.equal(JSON.parse(runCli(['lint-proposal', '--check-ratified', '--json', '--brand-dir', brandDir]).stdout).ok, false);
});

test('the output of every governance command is deterministic and carries no environment value', () => {
  const dir = tmpDir();
  const draft = finishedDraft(dir);
  const env = { HOME: '/home/should-not-appear', GITHUB_TOKEN: `gh${'p'}_${'Z9y8X7'.repeat(6)}`, BRAND_SECRET: 'sk-test-should-not-appear' };
  const a = runCli(['propose', 'submit', draft, '--actor-id', AI.id, '--actor-kind', 'ai', '--at', T1], env);
  const b = runCli(['propose', 'submit', draft, '--actor-id', AI.id, '--actor-kind', 'ai', '--at', T1]);
  assert.equal(a.stdout, b.stdout);
  for (const secret of Object.values(env)) assert.ok(!(a.stdout + a.stderr).includes(secret));
  const l1 = runCli(['lint-proposal', '--check-ratified'], env);
  assert.equal(l1.stdout, runCli(['lint-proposal', '--check-ratified']).stdout);
});

test('the commands change nothing outside the one file named by -o', () => {
  const brandDir = copyRepo();
  const snapshot = () => JSON.stringify(readdirSync(brandDir, { recursive: true }).sort().map((f) => [f, statSync(join(brandDir, f)).isFile() ? readFileSync(join(brandDir, f), 'utf8').length : 0]));
  const before = snapshot();
  const dir = tmpDir();
  runCli(INIT(join(dir, 'p.json'), ['--brand-dir', brandDir]));
  runCli(['lint-proposal', join(dir, 'p.json'), '--brand-dir', brandDir]);
  runCli(['lint-proposal', '--check-ratified', '--brand-dir', brandDir]);
  assert.equal(snapshot(), before);
  assert.deepEqual(readdirSync(dir), ['p.json']);
});

test('main() routes the governance commands and the usage text lists them', async () => {
  const lines = [];
  const code = await main(['lint-proposal', '--check-ratified'], { out: (l) => lines.push(l), err: (l) => lines.push(l) });
  assert.equal(code, 0);
  assert.match(lines.join('\n'), /ratified documents against the ledger/);
  const usage = runCli([]).stderr;
  for (const line of GOVERNANCE_USAGE.split('\n')) assert.ok(usage.includes(line.trim()), line);
});

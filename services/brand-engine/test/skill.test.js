// The Claude Skill is a thin interface: valid frontmatter, only real engine commands, no copy of the rubric,
// the honesty and precedence statements the owner required, and an installer that is safe.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { USAGE } from '../src/main.js';
import { indexRubric, loadRubric } from '../src/score/rubric.js';
import { BRAND, ROOT, tmpDir } from './_gov_helpers.js';
import { SKILL_NAME, defaultDest, install, main as installMain, plan } from '../skill/install.js';

const SKILL_DIR = join(ROOT, 'services', 'brand-engine', 'skill', SKILL_NAME);
const INSTALLER = join(ROOT, 'services', 'brand-engine', 'skill', 'install.js');
const walk = (dir, rel = '') => readdirSync(join(dir, rel)).sort().flatMap((n) => {
  const r = rel ? `${rel}/${n}` : n;
  return lstatSync(join(dir, r)).isDirectory() ? walk(dir, r) : [r];
});
const FILES = walk(SKILL_DIR);
const TEXT = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(SKILL_DIR, f), 'utf8')]));
const ALL = Object.values(TEXT).join('\n');

/** The frontmatter as a flat map, parsed strictly (a small YAML subset: `key: value` lines). */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z][a-z-]*): (.+)$/.exec(line);
    if (!kv) return { invalid: line };
    out[kv[1]] = kv[2];
  }
  return out;
}

test('SKILL.md frontmatter is valid: name matches the directory, a real description, nothing unknown', () => {
  const fm = frontmatter(TEXT['SKILL.md']);
  assert.ok(fm && !fm.invalid, `frontmatter: ${JSON.stringify(fm)}`);
  assert.deepEqual(Object.keys(fm).sort(), ['description', 'name']);
  assert.equal(fm.name, SKILL_NAME);
  assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fm.name.length <= 64);
  assert.ok(fm.description.length >= 50 && fm.description.length <= 1024, `description is ${fm.description.length} characters`);
  assert.match(fm.description, /^Use when/);
  assert.ok(!/[<>]/.test(fm.description));
  assert.match(fm.description, /advisory/i);
  assert.ok(!fm.description.includes('\n'));
});

test('the skill is documents only: Markdown files, no code, no data, SKILL.md at the top', () => {
  assert.deepEqual(FILES, ['SKILL.md', 'references/commands.md', 'references/report.md']);
  assert.ok(TEXT['SKILL.md'].split('\n').length <= 120, 'SKILL.md stays short');
  for (const f of FILES) assert.ok(f.endsWith('.md'), f);
});

// ---- every command the skill names exists, with real flags

const ALLOWED = new Map([
  ['analyze', null], ['plan', null], ['verify', null], ['score', null],
  ['evidence', ['assemble']], ['propose', ['init', 'submit']], ['lint-proposal', null],
  ['profile', ['list', 'show', 'resolve', 'validate']], ['framework', ['list', 'show']], ['rubric', ['show']],
]);
const COMMAND_LINES = ALL.split('\n').flatMap((line) => {
  const m = /node "\$ENGINE" (.+?)(`|$)/.exec(line);
  return m ? [m[1]] : [];
});

test('the skill calls only engine commands that exist, with flags the engine documents', () => {
  assert.ok(COMMAND_LINES.length >= 15, `found ${COMMAND_LINES.length} command lines`);
  const used = new Set();
  for (const line of COMMAND_LINES) {
    const [command, sub] = line.split(/\s+/);
    assert.ok(ALLOWED.has(command), `unknown command in the skill: ${line}`);
    used.add(command);
    assert.ok(USAGE.includes(`brand-engine ${command}`), `${command} is not in the engine usage`);
    const subs = ALLOWED.get(command);
    if (subs) assert.ok(subs.includes(sub), `${command} ${sub}`);
    for (const flag of line.match(/(?<=\s)--?[a-z][a-z-]*/g) ?? []) assert.ok(USAGE.includes(flag), `${flag} (in "${line}") is not in the engine usage`);
  }
  for (const required of ['analyze', 'plan', 'verify', 'score', 'propose']) assert.ok(used.has(required), `the skill never calls ${required}`);
});

test('the skill never calls a command that writes brand data, runs a tool, or reaches a network', () => {
  const never = ['curl', 'wget', 'http://', 'https://', 'fetch(', 'git push', 'git commit', 'npm ', 'npx ', 'rm -', 'chmod', 'ratify --', '--status ratified'];
  for (const word of never) assert.ok(!ALL.includes(word), word);
  for (const line of COMMAND_LINES) assert.ok(!/\b(ratified?)\b/.test(line), line);
  for (const [f, text] of Object.entries(TEXT)) assert.ok(!/Memory\.[a-z]+\(|Dopemine\.[a-z]+\(|dot\.memory\/|api\.dopemine/i.test(text), f);
  assert.match(TEXT['SKILL.md'], /no Dot\.Memory, no Dot\.Dopemine, no network/);
});

// ---- it holds no rubric and no scoring logic

test('the skill holds no copy of the rubric: no check id, no dimension id, no hash, no weight table', () => {
  const bundle = loadRubric(BRAND, 'bxqs-1.0.0');
  const index = indexRubric(bundle.rubric);
  const ids = [...index.dimensions.keys(), ...index.checks.keys(), ...[...index.metrics.values()].map((m) => m.id)];
  assert.ok(ids.length >= 60, `only ${ids.length} rubric ids found`);
  for (const id of ids) assert.ok(!ALL.includes(id), `the skill mentions rubric id ${id}`);
  assert.ok(!ALL.includes(bundle.sha256));
  assert.ok(!/\b\d{2,3}(\.\d)? ?(points|pts)\b/i.test(ALL), 'no point values');
  assert.ok(!/\b(weight|weights|ceiling\s*=|cap\s*=)\b/i.test(TEXT['SKILL.md']), 'no weights or caps in SKILL.md');
  assert.ok(!/bxqs-\d/.test(ALL), 'the rubric version is read from `rubric show`, not written here');
});

// ---- the statements the owner required

test('SKILL.md states: advisory only, evidence honesty, dimensions 11 and 12, precedence, never ratify', () => {
  const t = TEXT['SKILL.md'];
  assert.match(t, /\*\*Advisory only\.\*\*/);
  assert.match(t, /builder of a change never earns points/);
  assert.match(t, /written only by an AI is capped/);
  assert.match(t, /Automated results, expert opinion, observed behaviour and customer feedback stay separate/);
  assert.match(t, /\*\*Dimensions 11 and 12 are not measured without real data\.\*\*/);
  assert.match(t, /Opens, streaks, session time and scroll depth are never evidence/);
  assert.match(t, /Safety, regulation, accessibility, security and functional correctness always outrank brand/);
  assert.match(t, /Never ratify/);
  assert.match(t, /Only the owner ratifies/);
  assert.match(t, /You do not score, and you do not guess a score/);
  assert.match(t, /Dot\.Brain owns the profiles, the framework, the rubric, the scoring and the governance/);
});

test('the report template asks for the three honest lists: what was measured, what was not, what could not be done', () => {
  const t = TEXT['references/report.md'];
  for (const phrase of ['Not measured', 'What I could not do', 'Dimensions 11 and 12: not measured', 'earned nothing', 'Do not round a number up', 'rubric id']) assert.ok(t.toLowerCase().includes(phrase.toLowerCase()), phrase);
});

test('every exit code the skill lists matches the engine\'s own documentation', () => {
  const readme = readFileSync(join(ROOT, 'services', 'brand-engine', 'README.md'), 'utf8');
  assert.match(TEXT['references/commands.md'], /\| analyze, plan, evidence assemble \| done \| n\/a \| invalid input \| refused/);
  assert.match(readme, /`3` refused/);
  assert.match(TEXT['references/commands.md'], /No command sets `ratified`/);
});

// ---- the installer

test('install copies the skill and writes engine.path, and nothing else', () => {
  const dest = join(tmpDir('skill-'), 'dot-brand-experience');
  const r = install({ dest, enginePath: '/fixture/brain/services/brand-engine/src/cli.js' });
  assert.deepEqual(r.written.sort(), ['SKILL.md', 'engine.path', 'references/commands.md', 'references/report.md']);
  assert.deepEqual(walk(dest), ['SKILL.md', 'engine.path', 'references/commands.md', 'references/report.md']);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), TEXT['SKILL.md']);
  assert.equal(readFileSync(join(dest, 'engine.path'), 'utf8'), '/fixture/brain/services/brand-engine/src/cli.js\n');
});

test('install is idempotent, refuses to overwrite a differing file, and replaces it only with force', () => {
  const dest = join(tmpDir('skill-'), 'dot-brand-experience');
  install({ dest });
  assert.deepEqual(install({ dest }).written, []);
  writeFileSync(join(dest, 'SKILL.md'), 'edited by hand\n');
  assert.throws(() => install({ dest }), /refusing to overwrite SKILL\.md/);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), 'edited by hand\n');
  assert.deepEqual(install({ dest, force: true }).written, ['SKILL.md']);
  assert.equal(readFileSync(join(dest, 'SKILL.md'), 'utf8'), TEXT['SKILL.md']);
});

test('install updates engine.path when the checkout moves, without --force, and leaves other files in the destination alone', () => {
  const dest = join(tmpDir('skill-'), 'dot-brand-experience');
  install({ dest, enginePath: '/old/cli.js' });
  writeFileSync(join(dest, 'notes.txt'), 'mine\n');
  assert.deepEqual(install({ dest, enginePath: '/new/cli.js' }).written, ['engine.path']);
  assert.equal(readFileSync(join(dest, 'engine.path'), 'utf8'), '/new/cli.js\n');
  assert.equal(readFileSync(join(dest, 'notes.txt'), 'utf8'), 'mine\n');
});

test('a dry run writes nothing', () => {
  const dest = join(tmpDir('skill-'), 'dot-brand-experience');
  const r = install({ dest, dryRun: true });
  assert.equal(r.written.length, 4);
  assert.ok(!existsSync(dest));
  assert.ok(plan({ dest }).files.every((f) => f.action === 'create'));
});

test('install needs a destination and a source with a SKILL.md', () => {
  assert.throws(() => install({}), /needs a destination/);
  assert.throws(() => install({ dest: tmpDir('skill-'), source: tmpDir('empty-') }), /no SKILL\.md/);
});

test('the default destination is under the home directory: ~/.claude/skills/dot-brand-experience', () => {
  assert.equal(defaultDest('/home/example'), '/home/example/.claude/skills/dot-brand-experience');
});

test('the installer CLI: usage errors are exit 2, and with HOME pointing at a temporary directory it installs there and nowhere else', () => {
  const home = tmpDir('home-');
  const lines = [];
  assert.equal(installMain(['--nope'], { out: (l) => lines.push(l), err: (l) => lines.push(l), home }), 2);
  assert.equal(installMain(['--dest'], { out: (l) => lines.push(l), err: (l) => lines.push(l), home }), 2);
  assert.ok(!existsSync(join(home, '.claude')));
  const run = spawnSync(process.execPath, [INSTALLER], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(join(home, '.claude', 'skills', SKILL_NAME, 'SKILL.md')));
  assert.match(run.stdout, /Start a new Claude Code session/);
  const again = spawnSync(process.execPath, [INSTALLER], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
  assert.equal(again.status, 0);
  assert.match(again.stdout, /unchanged/);
});

test('the installer source has no network, no child process and no deletion', () => {
  const src = readFileSync(INSTALLER, 'utf8').replace(/\/\/.*$/gm, '');
  for (const re of [/child_process/, /node:https?/, /node:net\b/, /\bfetch\s*\(/, /\brmSync\b/, /\bunlinkSync\b/, /\brmdirSync\b/, /\beval\s*\(/]) assert.ok(!re.test(src), String(re));
});

test('the repository never contains the installed copy or an engine.path', () => {
  assert.ok(!existsSync(join(SKILL_DIR, 'engine.path')));
  mkdirSync(tmpDir('noop-'), { recursive: true });
});

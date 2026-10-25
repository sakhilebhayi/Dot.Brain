// The governance, Skill and Action documents say what the code does, the source keeps its boundary,
// and CODEOWNERS routes every governed path to the owner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GOVERNANCE_USAGE } from '../src/governance/cli.js';
import { ROOT } from './_helpers.js';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const GOV = join(ROOT, 'services', 'brand-engine', 'src', 'governance');
const stripComments = (t) => t.replace(/\/\/.*$/gm, '');

test('the governance source has no clock, no environment, no network, no process and no eval', () => {
  const files = walk(GOV).filter((p) => p.endsWith('.js'));
  assert.deepEqual(files.map((p) => p.slice(GOV.length + 1)).sort(), ['cli.js', 'lint.js', 'propose.js', 'targets.js']);
  const banned = [/child_process/, /node:https?/, /node:net\b/, /node:dgram/, /node:tls/, /\bfetch\s*\(/, /process\.env/, /\beval\s*\(/, /new Function\b/, /\bexecSync?\b/, /\bspawn(Sync)?\b/, /XMLHttpRequest/, /\bWebSocket\b/, /Date\.now\(|new Date\(/, /\brmSync\b|\bunlinkSync\b|\brmdirSync\b/];
  for (const f of files) {
    const text = stripComments(readFileSync(f, 'utf8'));
    for (const re of banned) assert.ok(!re.test(text), `${f.slice(GOV.length + 1)} matches ${re}`);
  }
});

test('governance writes through exactly one file, and no command can produce the final status', () => {
  const writers = walk(GOV).filter((p) => /writeFileSync|mkdirSync|renameSync|appendFile|copyFile/.test(stripComments(readFileSync(p, 'utf8'))));
  assert.deepEqual(writers.map((p) => p.slice(GOV.length + 1)), ['cli.js']);
  for (const name of ['propose.js', 'cli.js', 'targets.js']) {
    const text = stripComments(readFileSync(join(GOV, name), 'utf8'));
    assert.ok(!/status\s*[:=]\s*['"]ratified['"]/.test(text), `${name} assigns the ratified status`);
  }
  // The proposal writer does not so much as contain the word.
  assert.ok(!/ratif/i.test(readFileSync(join(GOV, 'propose.js'), 'utf8')));
});

test('every lint code in the source is documented in the README, and every documented code exists', () => {
  const src = readFileSync(join(GOV, 'lint.js'), 'utf8');
  const codes = new Set([...src.matchAll(/(?:error|warn|soft)\('([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 40, `found ${codes.size} codes`);
  const readme = read('services/brand-engine/README.md');
  for (const code of codes) assert.ok(readme.includes(`\`${code}\``), `README does not document ${code}`);
  const section = readme.slice(readme.indexOf('### What the lint refuses'), readme.indexOf('### The ledger'));
  for (const m of section.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)) assert.ok(codes.has(m[1]), `README documents a code that does not exist: ${m[1]}`);
});

test('the README, the usage text and the ADR document every governance command, flag and exit code', () => {
  const readme = read('services/brand-engine/README.md');
  for (const cmd of ['propose init', 'propose submit', 'lint-proposal']) assert.ok(GOVERNANCE_USAGE.includes(`brand-engine ${cmd}`) && readme.includes(`node src/cli.js ${cmd}`), cmd);
  for (const flag of ['--target', '--new', '--author-id', '--author-kind', '--author-name', '--created-at', '--slug', '--actor-id', '--actor-kind', '--at', '--json', '--check-ratified']) assert.ok(GOVERNANCE_USAGE.includes(flag) && readme.includes(flag), flag);
  for (const heading of ['## Governance', '### Who can do what', '### What the lint refuses', '### The ledger and `--check-ratified`', '## The Claude Skill', '## The assessment Action']) assert.ok(readme.includes(heading), heading);
  assert.match(readme, /No command, flag or code path writes `ratified`/);
  assert.match(readme, /`3` `propose submit` was given\s+a proposal that is not a draft/);
  const adr = read('adr/ADR-0024-brand-engine-governance-skill-action.md');
  assert.match(adr, /^status: proposed$/m);
  assert.match(adr, /Proposed — 2026-10-23/);
  for (const phrase of ['only a human reaches the last', 'No command, flag or code path sets `ratified`', 'verified_by', 'brand_yields', 'silent', 'ledger', 'check-ratified', 'holds no rubric', 'never overwrites', 'workflow_call', 'fail_on_blockers', 'no secret', 'Dot.Memory', 'ADR-0021', 'ADR-0022', 'ADR-0023', 'Branch protection', 'actionlint']) {
    assert.ok(adr.includes(phrase), phrase);
  }
});

test('the doctrine, the platform page, the cross-reference index and the root README record this increment', () => {
  assert.match(read('brain.brand_experience.md'), /ADR-0024/);
  assert.match(read('brain.brand_experience.md'), /No real product has been scored/);
  assert.match(read('platforms/dot-brain.md'), /\| 1\.4\.0 \| 2026-10-23 \|/);
  assert.match(read('platforms/dot-brain.md'), /ADR-0024/);
  assert.match(read('indexes/CROSSREF.md'), /\| 1\.0\.41 \| 2026-10-23 \|/);
  assert.match(read('indexes/CROSSREF.md'), /ADR-0024/);
  assert.match(read('README.md'), /\| 1\.11\.0 \| 2026-10-23 \|/);
  for (const [file, re] of [['brain.brand_experience.md', /\| 0\.4\.0 \| 2026-10-23 \|/], ['README.md', /proposal and changelog schemas/]]) assert.match(read(file), re, file);
});

test('the owner checklist names what only the owner can do', () => {
  const t = read('services/brand-engine/docs/owner-checklist.md');
  for (const phrase of ['Ratify', 'Branch protection', 'Install the Skill', 'Code Owners', 'skill/install.js', 'ratified', 'changelog.json', 'sha256', 'unverified citations', 'private', 'five participants']) assert.ok(t.includes(phrase), phrase);
  assert.match(t, /An AI session cannot do any of these/);
});

test('CODEOWNERS routes every governed path to the owner, and each path exists (except proposals, which does not yet)', () => {
  const c = read('.github/CODEOWNERS');
  const paths = [
    '/brand/', '/brand/rubrics/', '/brand/governance/', '/brand/proposals/', '/schemas/brand-proposal.schema.json', '/schemas/brand-changelog.schema.json',
    '/services/brand-engine/src/governance/', '/services/brand-engine/src/score/', '/services/brand-engine/skill/', '/services/brand-engine/ci/', '/.github/workflows/brand-assess.yml',
    '/brain.brand_experience.md', '/adr/ADR-0021-brand-feeling-engine.md', '/adr/ADR-0022-bxqs-scoring-policy.md', '/adr/ADR-0023-brand-engine-workflow-adapter-boundary.md', '/adr/ADR-0024-brand-engine-governance-skill-action.md', '/.github/CODEOWNERS',
  ];
  for (const p of paths) {
    assert.match(c, new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} @sakhilebhayi$`, 'm'), p);
    if (p !== '/brand/proposals/') assert.ok(existsSync(join(ROOT, p.slice(1))), `${p} does not exist`);
  }
  for (const line of c.split('\n').filter((l) => l && !l.startsWith('#'))) assert.match(line, /^\/\S+ @sakhilebhayi$/, line);
});

test('the ci helper runs nothing, opens no connection and deletes nothing', () => {
  const text = stripComments(read('services/brand-engine/ci/assess.js'));
  for (const re of [/child_process/, /node:https?/, /node:net\b/, /\bfetch\s*\(/, /\beval\s*\(/, /new Function\b/, /\bexecSync?\b/, /\bspawn(Sync)?\b/, /\brmSync\b|\bunlinkSync\b/, /writeFileSync|appendFile|mkdirSync/]) assert.ok(!re.test(text), String(re));
});

test('the new schemas are used by the code and are the only governance shapes (no second hand-copied definition)', () => {
  for (const f of ['schemas/brand-proposal.schema.json', 'schemas/brand-changelog.schema.json']) {
    const schema = JSON.parse(read(f));
    assert.equal(schema.type, 'object');
    assert.match(schema.description, /ADR-0024/);
  }
  const lint = read('services/brand-engine/src/governance/lint.js');
  assert.match(lint, /scoreSchema\('brand-proposal'\)/);
  assert.match(lint, /scoreSchema\('brand-changelog'\)/);
});

test('no new file holds a local path, an email address or a credential', () => {
  const files = [
    'adr/ADR-0024-brand-engine-governance-skill-action.md', 'brand/governance/README.md', 'brand/governance/changelog.json', '.github/workflows/brand-assess.yml',
    'services/brand-engine/docs/owner-checklist.md', 'services/brand-engine/skill/install.js', 'services/brand-engine/ci/assess.js',
    ...walk(join(ROOT, 'services', 'brand-engine', 'skill', 'dot-brand-experience')).map((p) => p.slice(ROOT.length)),
    ...walk(GOV).map((p) => p.slice(ROOT.length)),
  ];
  const secretish = new RegExp(`/Users/|/private/tmp|@gmail\\.com|gh${'p'}_[A-Za-z0-9]{36}`);
  for (const f of files) assert.ok(!secretish.test(read(f)), f);
});

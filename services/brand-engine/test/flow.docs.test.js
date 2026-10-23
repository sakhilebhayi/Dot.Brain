// The documents say what the workflow does, the boundary holds in the source, and nothing is left unpinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './_helpers.js';
import { WORKFLOW_USAGE } from '../src/analyze/cli.js';
import { REPORT_LIMITS, FILE_LIMITS, DETECTOR_CEILING } from '../src/analyze/limits.js';
import { EFFORT_BY_CHECK } from '../src/analyze/tables.js';
import { BUNDLE } from './_flow_helpers.js';

const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const SECRETISH = new RegExp(`/Users/|/private/tmp|@gmail\\.com|gh${'p'}_[A-Za-z0-9]{36}`);
const SRC = join(ROOT, 'services', 'brand-engine', 'src', 'analyze');

test('the engine runs nothing, opens no connection and reads no environment: the workflow source has none of the means', () => {
  const files = walk(SRC).filter((p) => p.endsWith('.js') && !p.includes(`${join(SRC, 'checks')}/`));
  assert.ok(files.length >= 20);
  const banned = [/child_process/, /node:http/, /node:https/, /node:net\b/, /node:dgram/, /node:tls/, /\bfetch\s*\(/, /process\.env/, /\beval\s*\(/, /new Function\b/, /\bexecSync?\b/, /\bspawn(Sync)?\b/, /\bexecFile/, /XMLHttpRequest/, /\bWebSocket\b/, /Date\.now\(|new Date\(/];
  for (const f of files) {
    const text = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
    for (const re of banned) assert.ok(!re.test(text), `${f.slice(SRC.length)} matches ${re}`);
  }
});

test('the workflow writes through exactly one function, and never under a path the user did not name', () => {
  const writers = walk(SRC).filter((p) => p.endsWith('.js')).filter((p) => /writeFileSync|writeFile\b|mkdirSync|renameSync|appendFile|rmSync|unlinkSync|copyFile/.test(readFileSync(p, 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(writers.map((p) => p.slice(SRC.length + 1)), ['cli.js']);
});

test('the usage text, the README and the ADR document every command, flag and exit code', () => {
  const readme = read('services/brand-engine/README.md');
  for (const cmd of ['analyze', 'plan', 'verify', 'evidence assemble']) assert.ok(WORKFLOW_USAGE.includes(`brand-engine ${cmd}`) && readme.includes(`node src/cli.js ${cmd}`), cmd);
  for (const heading of ['## Workflow: analyse, plan, verify, assemble', '### analyze', '### Adapters', '### plan', '### verify', '### evidence assemble', '### The check registry and the file API', '### The two files a person writes']) assert.ok(readme.includes(heading), heading);
  for (const flag of ['--profile', '--reports', '--out', '--before', '--plan', '--claimed', '--assessments', '--observed', '--built-by', '--generated-at', '--checks-dir', '--themes', '-o']) assert.ok(readme.includes(flag), flag);
  assert.match(readme, /`1` verify\s+only: regressions, or a claimed task that did not land/);
  assert.match(readme, /`3` refused/);
  for (const phrase of ['brand-assessments/1', 'brand-observed/1', 'claimed_not_landed', 'needs_human', 'withheld', 'x-provenance', 'reads reports', 'never runs']) assert.ok(readme.toLowerCase().includes(phrase.toLowerCase()), phrase);
  const adr = read('adr/ADR-0023-brand-engine-workflow-adapter-boundary.md');
  assert.match(adr, /^status: proposed$/m);
  assert.match(adr, /Proposed — 2026-10-23/);
  for (const phrase of ['never runs external tools', 'worker thread', 'claimed_not_landed', 'needs_human', 'withheld', 'integrity', 'ADR-0021', 'ADR-0022']) assert.ok(adr.includes(phrase), phrase);
});

test('the numbers the README states are the numbers in the code', () => {
  const readme = read('services/brand-engine/README.md');
  assert.ok(readme.includes(`at most ${REPORT_LIMITS.maxFiles} files, 8 MiB each, 32 MiB in all`));
  assert.equal(REPORT_LIMITS.maxFileBytes, 8 * 1024 * 1024);
  assert.equal(REPORT_LIMITS.maxTotalBytes, 32 * 1024 * 1024);
  assert.ok(readme.includes('oversized (1 MiB)'));
  assert.equal(FILE_LIMITS.maxFileBytes, 1024 * 1024);
  assert.ok(readme.includes(`\`1 - n / ${DETECTOR_CEILING}\``));
  assert.ok(readme.includes('30 s timeout'));
  assert.ok(readme.includes('S=1, M=3, L=8'));
});

test('the effort table names only checks the rubric defines, so a rubric change cannot silently orphan an estimate', () => {
  const ids = new Set(BUNDLE.rubric.dimensions.flatMap((d) => d.evidence.automated_check.checks.map((c) => c.id)));
  for (const id of Object.keys(EFFORT_BY_CHECK)) assert.ok(ids.has(id), id);
  for (const id of ids) assert.ok(id in EFFORT_BY_CHECK, `${id} has an effort estimate`);
});

test('the doctrine records the workflow in its change log, stays proposed, and does not claim a real product was scored', () => {
  const d = read('brain.brand_experience.md');
  assert.match(d, /^status: proposed$/m);
  assert.match(d, /^version: 0\.4\.0$/m);
  assert.match(d, /\| 0\.4\.0 \| 2026-10-23 \|/);
  assert.match(d, /\| 0\.3\.0 \| 2026-10-23 \|/);
  assert.match(d, /\| 0\.2\.0 \| 2026-10-23 \|/);
  assert.match(d, /No real product has been scored/);
  assert.match(d, /ADR-0023/);
});

test('CODEOWNERS routes the new schemas and the policy-bearing workflow code to the owner', () => {
  const c = read('.github/CODEOWNERS');
  for (const p of ['/schemas/brand-analysis.schema.json', '/schemas/brand-plan.schema.json', '/services/brand-engine/src/analyze/adapters/', '/services/brand-engine/src/analyze/plan.js', '/services/brand-engine/src/analyze/verify.js', '/services/brand-engine/src/analyze/finding-kinds.js', '/services/brand-engine/src/analyze/tables.js']) {
    assert.ok(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s+@sakhilebhayi$`, 'm').test(c), p);
  }
});

test('the workflow source calls no governance, Memory or Dopemine, and only tests.yml and brand-assess.yml name the engine', () => {
  for (const name of readdirSync(join(ROOT, '.github', 'workflows'))) {
    if (name === 'tests.yml' || name === 'brand-assess.yml') continue;
    assert.ok(!/brand-engine|bxqs/.test(read(`.github/workflows/${name}`)), name);
  }
  const text = walk(SRC).filter((p) => p.endsWith('.js')).map((p) => readFileSync(p, 'utf8')).join('\n');
  assert.ok(!/dot\.memory|dot-memory|dopemine\.|propose\(/i.test(text.replace(/\/\/.*$/gm, '').replace(/brain\.dopemine\.md/g, '')));
  assert.equal(statSync(join(ROOT, '.github', 'workflows', 'tests.yml')).isFile(), true);
});

test('every fixture the workflow tests use is marked as a fixture and none holds a real credential, path or address', () => {
  const dir = join(ROOT, 'services', 'brand-engine', 'test', 'fixtures');
  for (const sub of ['e2e', 'reports', 'analyze-checks', 'registry-checks', 'empty-checks']) {
    const files = walk(join(dir, sub));
    assert.ok(files.length > 0, sub);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      assert.ok(!SECRETISH.test(text), f);
    }
  }
  assert.match(read('services/brand-engine/test/fixtures/e2e/README.md'), /synthetic|made-up/i);
  assert.match(read('services/brand-engine/test/fixtures/e2e/product/FIXTURE.md'), /FIXTURE ONLY/);
  assert.match(read('services/brand-engine/test/fixtures/reports/README.md'), /synthetic/);
});

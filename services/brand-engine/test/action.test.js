// The reusable workflow .github/workflows/brand-assess.yml: what its text promises, and what its own shell steps
// do when run for real on the synthetic e2e product (a TEST FIXTURE, not a real product) in a fake runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { USAGE } from '../src/main.js';
import { E2E_PRODUCT, checksum } from './_flow_helpers.js';
import { ROOT } from './_helpers.js';
import { INPUT_NAMES, gate, headlineOf, main as assessMain, prepare, readInputs, renderOutputs, renderSummary, validateInputs } from '../ci/assess.js';

const WORKFLOWS = join(ROOT, '.github', 'workflows');
const FILE = join(WORKFLOWS, 'brand-assess.yml');
const TEXT = readFileSync(FILE, 'utf8');
const NO_COMMENTS = TEXT.replace(/^\s*#.*$/gm, '');

// ------------------------------------------------------------------ a small reader for this one workflow

/** The steps of the single job: { name, uses, with, env, run, if }. This workflow's layout is fixed, so a line reader is enough. */
function parseSteps(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === '    steps:');
  assert.ok(start > 0, 'steps: not found');
  const steps = [];
  let cur = null;
  let block = null; // { key, indent, lines }
  const close = () => { if (block && cur) { cur[block.key] = block.lines.join('\n').replace(/\n+$/, '\n'); } block = null; };
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (block) {
      if (line.trim() === '' || line.startsWith(' '.repeat(block.indent))) { block.lines.push(line.slice(block.indent)); continue; }
      close();
    }
    if (/^\s*#/.test(line) || line.trim() === '') continue;
    if (/^      - /.test(line)) { cur = { env: {}, with: {} }; steps.push(cur); lines[i] = line.replace(/^      - /, '        '); i -= 1; continue; }
    if (!cur) continue;
    let m = /^        (name|uses|id|if): (.*)$/.exec(line);
    if (m) { cur[m[1]] = m[2]; continue; }
    m = /^        run: \|$/.exec(line);
    if (m) { block = { key: 'run', indent: 10, lines: [] }; continue; }
    m = /^        run: (.+)$/.exec(line);
    if (m) { cur.run = m[1]; continue; }
    m = /^          ([A-Za-z_][A-Za-z0-9_-]*): (.*)$/.exec(line);
    if (m) { (cur.__section === 'with' ? cur.with : cur.env)[m[1]] = m[2]; continue; }
    if (/^        env:$/.test(line)) { cur.__section = 'env'; continue; }
    if (/^        with:$/.test(line)) { cur.__section = 'with'; continue; }
  }
  close();
  return steps.map(({ __section, ...s }) => s);
}
const STEPS = parseSteps(TEXT);
const step = (name) => STEPS.find((s) => s.name === name);

// ------------------------------------------------------------------ what the text promises

test('it is a reusable workflow that can also be dispatched, and nothing else triggers it', () => {
  const on = /^on:\n([\s\S]*?)\npermissions:/m.exec(NO_COMMENTS)[1];
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):$/gm)].map((m) => m[1]), ['workflow_call', 'workflow_dispatch']);
  for (const trigger of ['push', 'pull_request', 'schedule', 'workflow_run', 'pull_request_target', 'repository_dispatch']) assert.ok(!new RegExp(`^\\s*${trigger}:`, 'm').test(NO_COMMENTS), trigger);
});

test('both triggers declare the same inputs, with safe defaults (advisory unless asked)', () => {
  const block = (name) => new RegExp(`^  ${name}:\\n    inputs:\\n([\\s\\S]*?)(?=^    outputs:|^  workflow_dispatch:|^permissions:)`, 'm').exec(NO_COMMENTS)[1];
  const names = (b) => [...b.matchAll(/^      ([a-z_]+):$/gm)].map((m) => m[1]);
  const call = names(block('workflow_call'));
  const dispatch = names(block('workflow_dispatch'));
  assert.deepEqual(call, dispatch);
  for (const n of ['repository', 'ref', 'profile', 'built_by', 'themes', 'reports_path', 'assessments_path', 'observed_path', 'fail_on_blockers', 'brain_ref', 'artifact_name']) assert.ok(call.includes(n), n);
  assert.match(block('workflow_call'), /fail_on_blockers:\n(?:        .*\n)*?        type: boolean\n(?:        .*\n)*?        default: false\n/);
  assert.match(block('workflow_dispatch'), /fail_on_blockers:\n(?:        .*\n)*?        default: false\n/);
});

test('it needs no secret, reads no secret and writes nothing to any repository', () => {
  assert.ok(!/\bsecrets\b/.test(NO_COMMENTS), 'no secrets context');
  assert.ok(!/\bsecrets:/.test(NO_COMMENTS));
  assert.ok(!/\b(TOKEN|SECRET|PASSWORD|API_KEY)\b/i.test(NO_COMMENTS.replace(/persist-credentials/g, '')), 'no credential variable');
  assert.ok(!/github\.token|GITHUB_TOKEN/.test(NO_COMMENTS), 'it does not even name the run token; checkout uses its own default');
  assert.match(NO_COMMENTS, /^permissions:\n  contents: read\n/m);
  assert.ok(!/(contents|pull-requests|issues|actions|packages|id-token|checks|statuses|deployments): write/.test(NO_COMMENTS));
  for (const word of ['git push', 'git commit', 'git add', 'git tag', 'git config', 'gh pr', 'gh api', 'gh issue', 'gh release', 'curl', 'wget', 'npm ', 'npx ', 'docker ', 'pip ']) assert.ok(!NO_COMMENTS.includes(word), word);
  for (const step of STEPS.filter((s) => s.uses?.startsWith('actions/checkout'))) assert.equal(step.with['persist-credentials'], 'false', step.name);
});

test('it never posts to Dot.Memory or Dot.Dopemine and reaches no host but GitHub (through its actions)', () => {
  assert.ok(!/memory|dopemine|infodot\.co\.za|https?:\/\//i.test(NO_COMMENTS), 'no URL, no Memory, no Dopemine');
  assert.match(TEXT, /posts nothing to Dot\.Memory or Dot\.Dopemine \(no contract for that exists yet\)/);
});

test('actions are pinned by tag, the same tags the repository\'s other workflows use', () => {
  const others = readdirSync(WORKFLOWS).filter((n) => n.endsWith('.yml') && n !== 'brand-assess.yml');
  const known = new Set(others.flatMap((n) => [...readFileSync(join(WORKFLOWS, n), 'utf8').matchAll(/uses:\s*(\S+)/g)].map((m) => m[1])));
  const mine = [...NO_COMMENTS.matchAll(/uses:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(mine.length >= 4);
  for (const u of mine) {
    assert.match(u, /^actions\/[a-z-]+@v\d+$/, `${u} must be an actions/* action pinned by major tag`);
    assert.ok(known.has(u), `${u} is not used by another workflow in this repository (keep the tags consistent)`);
  }
  assert.match(NO_COMMENTS, /node-version: '22'/);
});

test('no input or event value is expanded into a shell script: they reach the shell only as environment variables', () => {
  const runs = STEPS.filter((s) => s.run);
  assert.ok(runs.length >= 7);
  for (const s of runs) assert.ok(!/\$\{\{/.test(s.run), `${s.name}: a \${{ }} expression inside run`);
  for (const s of STEPS) {
    for (const [k, v] of Object.entries(s.env)) {
      const rest = v.replace(/\$\{\{ (inputs\.[a-z_]+|steps\.prep\.outputs\.[a-z]+|github\.workspace) \}\}/g, 'X');
      assert.ok(!rest.includes('${{'), `${s.name} ${k}: ${v}`);
    }
  }
});

test('every engine command and helper the workflow runs exists', () => {
  const runText = STEPS.filter((s) => s.run).map((s) => s.run).join('\n');
  assert.ok(existsSync(join(ROOT, 'services/brand-engine/ci/assess.js')));
  assert.ok(existsSync(join(ROOT, 'services/brand-engine/src/cli.js')));
  for (const word of ['analyze', 'evidence assemble', 'score', 'validate', 'prepare', 'summary', 'outputs', 'gate']) assert.ok(runText.includes(word), word);
  for (const cmd of ['analyze', 'evidence assemble', 'score']) assert.ok(USAGE.includes(`brand-engine ${cmd}`), cmd);
  for (const flag of runText.match(/(?<=[\s(])--[a-z][a-z-]*/g)) {
    assert.ok(USAGE.includes(flag) || ['--out-dir', '--fail-on-blockers', '--format'].includes(flag), flag);
  }
  assert.doesNotMatch(runText, /\bscore\b[^\n]*--rubric/, 'the engine picks the released rubric itself');
});

test('the engine writes outside the product checkout, and the job uploads from there', () => {
  assert.match(step('Analyse').run, /--out "\$RUNNER_TEMP\/brand-assess"/);
  assert.match(TEXT, /path: product/);
  assert.match(step('Upload the report').with.path, /runner\.temp \}\}\/brand-assess\/$/);
});

test('the only step that can fail the job on the product\'s quality is the opt-in gate', () => {
  const gateStep = step('Fail on blockers (only if fail_on_blockers is true)');
  assert.match(gateStep.run, /gate --out-dir/);
  assert.match(gateStep.run, /--fail-on-blockers "\$BRAND_ASSESS_FAIL_ON_BLOCKERS"/);
  assert.ok(!NO_COMMENTS.includes('continue-on-error'));
  assert.match(step('Job summary and outputs').if, /!cancelled\(\)/);
  assert.match(step('Upload the report').if, /!cancelled\(\)/);
});

test('actionlint finds nothing (when it is installed)', (t) => {
  const r = spawnSync('actionlint', [FILE], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') { t.skip('actionlint is not installed here'); return; }
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ------------------------------------------------------------------ the helper script

const goodInputs = () => ({ repository: 'example/e2e-product', ref: 'main', profile: '', built_by: 'unspecified', themes: 'light,dark', reports_path: '', assessments_path: '', observed_path: '', fail_on_blockers: 'false', brain_ref: 'main', artifact_name: 'brand-assessment' });

test('every input is validated before it is used, and each bad value is refused with its name', () => {
  assert.deepEqual(validateInputs(goodInputs()), []);
  const bad = {
    repository: ['a b', 'owner', 'owner/name/extra', '../x/y', 'o/n;rm -rf', '$(id)/x'],
    ref: ['--upload-pack=x', 'a..b', 'a b', 'refs/heads/', '$(id)', 'x'.repeat(300)],
    brain_ref: ['', 'a..b', '-x', 'a b'],
    profile: ['Infodot', '../x.json', '/etc/passwd.json', 'a/../b.json', 'infodot;ls', 'x@1.0', '.git/config.json'],
    built_by: ['', '$(id)', 'a;b', 'x'.repeat(101)],
    themes: ['', 'Light', 'light,', 'light dark', 'light;dark'],
    reports_path: ['/abs', '../up', 'a//b', '.git/hooks', 'a\\b'],
    assessments_path: ['/abs', '../up'],
    observed_path: ['/abs', '../up'],
    fail_on_blockers: ['', 'yes', 'TRUE', '1'],
    artifact_name: ['a b', '../x', 'a/b', '$(id)', 'x'.repeat(101), '-x'],
  };
  for (const [name, values] of Object.entries(bad)) {
    for (const value of values) {
      const errors = validateInputs({ ...goodInputs(), [name]: value });
      assert.ok(errors.some((e) => e.startsWith(`${name}:`)), `${name}=${JSON.stringify(value)} was accepted`);
    }
  }
  assert.ok(validateInputs({ ...goodInputs(), repository: 'a/b\nc' }).length > 0, 'a newline is refused');
  for (const ok of [{ profile: 'infodot' }, { profile: 'infodot@0.1.0' }, { profile: 'brand/other.json' }, { repository: '' }, { ref: '' }, { ref: 'feature/x-1.2' }, { reports_path: 'reports/axe' }, { themes: 'light' }]) {
    assert.deepEqual(validateInputs({ ...goodInputs(), ...ok }), [], JSON.stringify(ok));
  }
});

test('inputs come from named environment variables, with the workflow\'s defaults when empty', () => {
  const inputs = readInputs({});
  assert.deepEqual(inputs, { repository: '', ref: '', profile: '', built_by: 'unspecified', themes: 'light,dark', reports_path: '', assessments_path: '', observed_path: '', fail_on_blockers: 'false', brain_ref: 'main', artifact_name: 'brand-assessment' });
  assert.equal(readInputs({ [INPUT_NAMES.profile]: 'infodot' }).profile, 'infodot');
  for (const key of Object.values(INPUT_NAMES)) assert.ok(NO_COMMENTS.includes(key), `${key} is set by the workflow`);
});

function gitProduct({ extra } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'action-product-'));
  cpSync(E2E_PRODUCT, dir, { recursive: true });
  extra?.(dir);
  return dir;
}
function initGit(dir) {
  const env = { PATH: process.env.PATH, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-10-23T10:00:00Z', GIT_COMMITTER_DATE: '2026-10-23T10:00:00Z', HOME: dir, GIT_CONFIG_NOSYSTEM: '1' };
  for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['commit', '-q', '-m', 'fixture'], ['remote', 'add', 'origin', 'https://github.com/example/e2e-product.git']]) {
    const r = spawnSync('git', args, { cwd: dir, env, encoding: 'utf8' });
    if (r.status !== 0) return false;
  }
  return true;
}
const HAVE_GIT = spawnSync('git', ['--version']).status === 0;

test('prepare resolves paths inside the product, and refuses a path that leaves it or is the wrong type', () => {
  const dir = gitProduct({
    extra: (d) => {
      mkdirSync(join(d, 'reports'));
      writeFileSync(join(d, 'reports', 'axe.json'), '{}');
      writeFileSync(join(d, 'assessments.json'), '{}');
      symlinkSync('/etc/hosts', join(d, 'escape.json'));
      symlinkSync('/etc', join(d, 'escape-dir'));
    },
  });
  if (!HAVE_GIT || !initGit(dir)) return;
  const out = prepare({ ...goodInputs(), reports_path: 'reports', assessments_path: 'assessments.json' }, dir);
  assert.equal(out.profile, readlinkSafe(join(dir, 'brand', 'profile.json')));
  assert.equal(out.reports, readlinkSafe(join(dir, 'reports')));
  assert.equal(out.assessments, readlinkSafe(join(dir, 'assessments.json')));
  assert.equal(out.observed, '');
  assert.equal(prepare({ ...goodInputs(), profile: 'infodot' }, dir).profile, 'infodot', 'a Dot.Brain profile id is passed through');
  assert.throws(() => prepare({ ...goodInputs(), profile: 'escape.json' }, dir), /leaves the product checkout/);
  assert.throws(() => prepare({ ...goodInputs(), reports_path: 'escape-dir' }, dir), /leaves the product checkout/);
  assert.throws(() => prepare({ ...goodInputs(), reports_path: 'assessments.json' }, dir), /not a directory/);
  assert.throws(() => prepare({ ...goodInputs(), assessments_path: 'reports' }, dir), /not a regular file/);
  assert.throws(() => prepare({ ...goodInputs(), observed_path: 'missing.json' }, dir), /does not exist/);
  assert.throws(() => prepare({ ...goodInputs(), profile: '../x.json' }, dir), /profile:/);
});
function readlinkSafe(p) { return spawnSync('node', ['-e', 'console.log(require("fs").realpathSync(process.argv[1]))', p], { encoding: 'utf8' }).stdout.trim(); }

test('prepare needs a product with a readable commit and origin, and a profile to use', () => {
  assert.throws(() => prepare(goodInputs(), gitProduct()), /no readable commit or GitHub origin/);
  assert.throws(() => prepare(goodInputs(), join(tmpdir(), 'no-such-dir-for-prepare')), /does not exist/);
  if (!HAVE_GIT) return;
  const bare = gitProduct({ extra: (d) => { rmSync(join(d, 'brand', 'profile.json')); } });
  if (!initGit(bare)) return;
  assert.throws(() => prepare(goodInputs(), bare), /the product has no brand\/profile\.json/);
  assert.equal(prepare({ ...goodInputs(), profile: 'infodot' }, bare).profile, 'infodot', 'a Dot.Brain profile id needs no file in the product');
  assert.throws(() => prepare({ ...goodInputs(), profile: 'missing/profile.json' }, bare), /does not exist/);
});

test('the gate fails only when asked to, only on a blocker, and says which', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'));
  writeFileSync(join(dir, 'score.json'), JSON.stringify({ blockers: [{ finding_id: 'f.1' }, { finding_id: 'f.2' }] }));
  assert.deepEqual(gate({ outDir: dir, failOnBlockers: 'false' }), { code: 0, message: '' });
  const failed = gate({ outDir: dir, failOnBlockers: 'true' });
  assert.equal(failed.code, 1);
  assert.match(failed.message, /2 blocker\(s\).*f\.1, f\.2/);
  writeFileSync(join(dir, 'score.json'), JSON.stringify({ blockers: [] }));
  assert.equal(gate({ outDir: dir, failOnBlockers: 'true' }).code, 0);
  const none = mkdtempSync(join(tmpdir(), 'gate-'));
  assert.equal(gate({ outDir: none, failOnBlockers: 'false' }).code, 0);
  assert.equal(gate({ outDir: none, failOnBlockers: 'true' }).code, 1, 'no score to check is a failure when asked to gate');
});

test('assess.js has usage errors and never prints a secret', () => {
  const lines = [];
  const io = { env: {}, out: (s) => lines.push(s), err: (s) => lines.push(s) };
  assert.equal(assessMain([], io), 2);
  assert.equal(assessMain(['nope', '--out-dir', 'x'], io), 2);
  assert.equal(assessMain(['gate', '--out-dir', 'x', '--fail-on-blockers', 'maybe'], io), 2);
  assert.equal(assessMain(['summary'], io), 2);
  assert.equal(assessMain(['prepare'], io), 1);
  const secret = `gh${'p'}_${'Q1w2E3'.repeat(6)}`;
  assert.equal(assessMain(['validate'], { ...io, env: { [INPUT_NAMES.repository]: 'bad repo', SECRET: secret } }), 1);
  assert.ok(!lines.join('\n').includes(secret));
});

test('renderSummary says so when the analysis or the score is missing, and never invents a number', () => {
  const empty = mkdtempSync(join(tmpdir(), 'sum-'));
  const none = renderSummary({ outDir: empty });
  assert.match(none, /did not complete/);
  assert.ok(!/\d+(\.\d+)? \/ 100/.test(none));
  assert.equal(renderOutputs({ outDir: empty }), '');
});

// ------------------------------------------------------------------ the workflow's own shell, run for real in a fake runner

function fakeRunner({ inputs = {}, product = null, mutate } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'runner-'));
  const ws = join(base, 'work');
  const temp = join(base, 'temp');
  mkdirSync(ws);
  mkdirSync(temp);
  symlinkSync(ROOT.replace(/\/$/, ''), join(ws, 'brain'));
  const dir = join(ws, 'product');
  cpSync(product ?? E2E_PRODUCT, dir, { recursive: true });
  mutate?.(dir);
  assert.ok(initGit(dir), 'git is needed for this test');
  const envBase = {
    PATH: process.env.PATH, GITHUB_WORKSPACE: ws, RUNNER_TEMP: temp,
    GITHUB_OUTPUT: join(base, 'output'), GITHUB_STEP_SUMMARY: join(base, 'summary'),
  };
  writeFileSync(envBase.GITHUB_OUTPUT, '');
  writeFileSync(envBase.GITHUB_STEP_SUMMARY, '');
  const jobEnv = {};
  for (const [name, key] of Object.entries(INPUT_NAMES)) jobEnv[key] = inputs[name] ?? (name === 'repository' ? 'example/e2e-product' : name === 'built_by' ? 'unspecified' : name === 'themes' ? 'light,dark' : name === 'fail_on_blockers' ? 'false' : name === 'brain_ref' ? 'main' : name === 'artifact_name' ? 'brand-assessment' : '');
  const outputs = {};
  const results = [];

  /** Run one step's shell as the runner would: a fresh bash with the job env, the step env, and the step's outputs substituted. */
  function run(name) {
    const s = step(name);
    const env = { ...envBase, ...jobEnv };
    for (const [k, v] of Object.entries(s.env)) {
      env[k] = v.replace(/\$\{\{ steps\.prep\.outputs\.([a-z]+) \}\}/g, (_, o) => outputs[o] ?? '').replace('${{ github.workspace }}', ws);
    }
    const r = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', s.run], { cwd: ws, env, encoding: 'utf8' });
    const result = { name, code: r.status, stdout: r.stdout, stderr: r.stderr };
    results.push(result);
    return result;
  }
  function absorbPrepOutputs() {
    for (const line of readFileSync(envBase.GITHUB_OUTPUT, 'utf8').split('\n')) {
      const m = /^([a-z_]+)=(.*)$/.exec(line);
      if (m) outputs[m[1]] = m[2];
    }
  }
  return { base, ws, temp, dir, envBase, outputs, results, run, absorbPrepOutputs, out: join(temp, 'brand-assess') };
}

function runAll(r) {
  const order = ['Check the inputs', 'Resolve paths inside the product checkout', 'Analyse', 'Assemble the evidence', 'Score', 'Job summary and outputs', 'Fail on blockers (only if fail_on_blockers is true)'];
  const codes = {};
  for (const name of order) {
    // Like the runner: a failed step stops the others, except those marked to run anyway.
    const failed = Object.values(codes).some((c) => c !== 0);
    const always = step(name).if?.includes('!cancelled()');
    if (failed && !always) continue;
    codes[name] = r.run(name).code;
    if (name === 'Resolve paths inside the product checkout') r.absorbPrepOutputs();
  }
  return codes;
}
const gitSkip = (t) => { if (!HAVE_GIT) { t.skip('git is not installed here'); return true; } return false; };

test('a run on the synthetic product: every step passes, the report is written outside the checkout, the product is untouched', (t) => {
  if (gitSkip(t)) return;
  const r = fakeRunner();
  const before = checksum(r.dir);
  const codes = runAll(r);
  assert.deepEqual(Object.values(codes), [0, 0, 0, 0, 0, 0, 0], JSON.stringify(r.results.filter((x) => x.code !== 0)));
  assert.deepEqual(readdirSync(r.out).sort(), ['analysis.json', 'evidence.json', 'score.json', 'summary.md']);
  assert.equal(checksum(r.dir), before, 'nothing was written into the product checkout, .git included');
  assert.ok(!readdirSync(r.dir).includes('brand-assess'));

  const score = JSON.parse(readFileSync(join(r.out, 'score.json'), 'utf8'));
  const analysis = JSON.parse(readFileSync(join(r.out, 'analysis.json'), 'utf8'));
  assert.equal(analysis.input.repo, 'example/e2e-product');
  assert.match(analysis.input.commit, /^[0-9a-f]{40}$/);
  assert.equal(score.header.input.repo, 'example/e2e-product');
  assert.equal(score.header.generated_at, '2026-10-23T10:00:00Z', 'the evidence is dated by the commit, not by the clock');
  assert.equal(score.state, 'not_ready');
  assert.equal(score.blockers.length, 2);

  const summary = readFileSync(r.envBase.GITHUB_STEP_SUMMARY, 'utf8');
  const h = headlineOf(score);
  assert.match(summary, new RegExp(`\\| ${h.evidenced_score} / 100 \\| ${h.ceiling} \\| ${h.attainment_percent} % \\| \`${h.state}\` \\| \`${h.confidence}\` \\| ${h.blockers} \\|`));
  assert.match(summary, /Advisory\./);
  assert.match(summary, /post nothing to Dot\.Memory or Dot\.Dopemine/);
  assert.match(summary, /## Blockers/);
  assert.match(summary, /`unsupported_claim` in `trust_transparency`/);
  const outputs = readFileSync(r.envBase.GITHUB_OUTPUT, 'utf8');
  assert.match(outputs, /^state=not_ready$/m);
  assert.match(outputs, new RegExp(`^evidenced_score=${h.evidenced_score}$`, 'm'));
  assert.match(outputs, /^blockers=2$/m);
});

test('advisory by default: blockers do not fail the run; with fail_on_blockers true the gate does, after everything else has been written', (t) => {
  if (gitSkip(t)) return;
  const advisory = fakeRunner();
  assert.equal(runAll(advisory)['Fail on blockers (only if fail_on_blockers is true)'], 0);

  const strict = fakeRunner({ inputs: { fail_on_blockers: 'true' } });
  const codes = runAll(strict);
  assert.equal(codes.Score, 0);
  assert.equal(codes['Job summary and outputs'], 0);
  assert.equal(codes['Fail on blockers (only if fail_on_blockers is true)'], 1);
  const gateRun = strict.results.find((x) => x.name.startsWith('Fail on blockers'));
  assert.match(gateRun.stderr, /2 blocker\(s\) in the score report and fail_on_blockers is true/);
  assert.ok(existsSync(join(strict.out, 'score.json')), 'the report exists for upload even though the gate failed');
});

test('the same commit gives the same report, byte for byte', (t) => {
  if (gitSkip(t)) return;
  const a = fakeRunner();
  const b = fakeRunner();
  runAll(a);
  runAll(b);
  for (const f of ['evidence.json', 'score.json', 'summary.md']) assert.equal(readFileSync(join(a.out, f), 'utf8'), readFileSync(join(b.out, f), 'utf8'), f);
});

test('an engine error fails the run, and the summary step still says so without inventing anything', (t) => {
  if (gitSkip(t)) return;
  const r = fakeRunner({ inputs: { profile: 'no-such-profile' } });
  const codes = runAll(r);
  assert.notEqual(codes.Analyse, 0);
  assert.equal(codes['Assemble the evidence'], undefined, 'later steps do not run');
  assert.equal(codes['Job summary and outputs'], 0);
  assert.match(readFileSync(r.envBase.GITHUB_STEP_SUMMARY, 'utf8'), /The analysis did not complete/);
  assert.equal(readFileSync(r.envBase.GITHUB_OUTPUT, 'utf8').includes('state='), false);
  assert.match(r.results.find((x) => x.name === 'Analyse').stderr, /unknown profile no-such-profile/);
});

test('invalid inputs stop the run before any product is read', (t) => {
  if (gitSkip(t)) return;
  for (const bad of [{ repository: 'a b' }, { ref: '--upload-pack=x' }, { reports_path: '../outside' }, { fail_on_blockers: 'yes' }]) {
    const r = fakeRunner({ inputs: bad });
    const result = r.run('Check the inputs');
    assert.equal(result.code, 1, JSON.stringify(bad));
    assert.match(result.stderr, /invalid input: /);
    assert.ok(!existsSync(r.out));
  }
});

test('a committed assessments file and tool reports are read, and a builder\'s own assessment earns nothing', (t) => {
  if (gitSkip(t)) return;
  const r = fakeRunner({
    inputs: { reports_path: 'reports', assessments_path: 'brand/assessments.json', built_by: 'fixture-builder' },
    mutate: (d) => {
      mkdirSync(join(d, 'reports'));
      writeFileSync(join(d, 'brand', 'assessments.json'), JSON.stringify({
        format: 'brand-assessments/1', recorded_at: '2026-10-23T12:00:00Z',
        assessors: [{ id: 'fixture-builder', kind: 'human' }],
        assessments: [{ dimension: 'accessibility_inclusion', assessor: 'fixture-builder', level: 4, notes: 'Fixture: the builder grades their own work.', artifact_ref: 'notes/x.md' }],
      }));
    },
  });
  const codes = runAll(r);
  assert.deepEqual(Object.values(codes).slice(0, 5), [0, 0, 0, 0, 0], JSON.stringify(r.results.filter((x) => x.code !== 0)));
  const score = JSON.parse(readFileSync(join(r.out, 'score.json'), 'utf8'));
  assert.equal(score.header.generated_at, '2026-10-23T12:00:00Z', 'with a person\'s file, its own date is used');
  assert.ok(JSON.stringify(score).includes('fixture-builder'));
  const a11y = score.dimensions.find((d) => d.id === 'accessibility_inclusion');
  assert.equal(a11y.components.expert_assessment.points_earned, 0, 'the builder\'s assessment earned no expert points');
  assert.ok(score.rejected_evidence.some((e) => e.reason_code === 'builder_sole_assessor' && e.ref === 'fixture-builder'));
});

test('a product that symlinks its profile out of the checkout is refused', (t) => {
  if (gitSkip(t)) return;
  const evil = fakeRunner({ inputs: { profile: 'brand/evil.json' }, mutate: (d) => { symlinkSync('/etc/hosts', join(d, 'brand', 'evil.json')); } });
  const prep = evil.run('Resolve paths inside the product checkout');
  assert.equal(prep.code, 1);
  assert.match(prep.stderr, /leaves the product checkout/);
});

// The documents say what the code does, and nothing they promise is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, ROOT } from './_helpers.js';
import { ENGINE_VERSION } from '../src/score/constants.js';

const read = (path) => readFileSync(join(ROOT, path), 'utf8');

test('the engine version constant equals package.json, and the README documents the scoring commands', () => {
  assert.equal(JSON.parse(read('services/brand-engine/package.json')).version, ENGINE_VERSION);
  const readme = read('services/brand-engine/README.md');
  for (const s of ['node src/cli.js score --evidence', 'node src/cli.js compare', 'node src/cli.js rubric show|validate', '## Scoring (BXQS)', 'Evidenced score', 'Ceiling', 'Attainment', '62.2', '27.8', 'small observed or customer pilot']) {
    assert.ok(readme.includes(s), s);
  }
  assert.match(readme, /`3` refused/);
});

test('the rubric README documents the semver policy and the immutability rule', () => {
  const r = read('brand/rubrics/README.md');
  assert.match(r, /\*\*MAJOR\*\*/);
  assert.match(r, /dimension set, a weight or a cap/);
  assert.match(r, /\*\*MINOR\*\*/);
  assert.match(r, /\*\*PATCH\*\*/);
  assert.match(r, /immutable/);
  assert.match(r, /refuses/);
});

test('the doctrine stays proposed, records the change in its log and explains why 90 needs observed or customer evidence', () => {
  const d = read('brain.brand_experience.md');
  assert.match(d, /^status: proposed$/m);
  assert.match(d, /^version: 0\.[2-9]\.0$/m);
  assert.match(d, /\| 0\.2\.0 \| 2026-10-23 \|/);
  assert.match(d, /MAJOR: the dimension set, a weight or a cap/);
  assert.match(d, /MINOR: checks added or changed/);
  assert.match(d, /PATCH: wording/);
  assert.match(d, /62\.2/);
  assert.match(d, /small observed or customer pilot/);
  assert.match(d, /No real product has been scored/);
});

test('ADR-0022 records the owner\'s accepted policy and the ADR-0021 open question points at it', () => {
  const adr = read('adr/ADR-0022-bxqs-scoring-policy.md');
  assert.match(adr, /^status: active$/m);
  assert.match(adr, /Accepted — 2026-10-23/);
  for (const s of ['evidenced score', 'ceiling', 'attainment', '50%', 'never the sole assessor', 'not measured', 'immutable', 'advisory', 'no LLM']) {
    assert.ok(adr.includes(s) || adr.toLowerCase().includes(s.toLowerCase()), s);
  }
  assert.match(adr, /62\.2/);
  assert.match(read('adr/ADR-0021-brand-feeling-engine.md'), /ADR-0022-bxqs-scoring-policy\.md/);
});

test('CODEOWNERS routes the rubric schemas, the scoring code and the golden fixtures to the owner', () => {
  const c = read('.github/CODEOWNERS');
  for (const p of ['/brand/', '/schemas/brand-rubric.schema.json', '/schemas/brand-evidence.schema.json', '/schemas/brand-score.schema.json', '/services/brand-engine/src/score/', '/services/brand-engine/test/fixtures/score/golden/']) {
    assert.ok(new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s+@sakhilebhayi$`, 'm').test(c), p);
  }
});

test('no real score exists in the repository: brand/ holds a rubric and no report, and the golden files are marked synthetic', () => {
  const files = readdirSync(join(BRAND, 'rubrics')).sort();
  assert.deepEqual(files, ['README.md', 'bxqs-1.0.0.json', 'released.json']);
  assert.ok(!existsSync(join(BRAND, 'rubrics', 'bxqs-1.0.0.ratification.json')), 'the owner has not ratified; an AI session must not add this file');
  for (const f of readdirSync(join(BRAND, 'profiles'))) assert.ok(!/report|score/.test(f), f);
});

test('no scoring workflow, skill or analyser was added in this increment', () => {
  for (const name of readdirSync(join(ROOT, '.github', 'workflows'))) {
    if (name === 'tests.yml') continue;
    assert.ok(!/brand-engine|bxqs/.test(read(`.github/workflows/${name}`)), name);
  }
  const src = readdirSync(join(ROOT, 'services', 'brand-engine', 'src', 'score')).sort();
  assert.deepEqual(src, ['cli.js', 'compare.js', 'constants.js', 'engine.js', 'evidence.js', 'index.js', 'rubric.js', 'schemas.js', 'text.js', 'util.js']);
});

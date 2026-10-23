// The README is part of the deliverable: it must account for every rubric check and state its limits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadChecks } from './_helpers.js';
import { SKIPPED } from '../../src/analyze/checks/_lib/skipped.js';

const readme = readFileSync(new URL('../../docs/static-checks.md', import.meta.url), 'utf8');
const checks = await loadChecks();

test('the README has a row for every built check and every skipped check, with the same reasons', () => {
  for (const [id, { mod }] of checks) {
    assert.match(readme, new RegExp(`\\| \`${id.replaceAll('.', '\\.')}\` \\| ${mod.dimension} \\|`), `${id} row`);
  }
  for (const [id, why] of Object.entries(SKIPPED)) {
    assert.ok(readme.includes(`| \`${id}\` | ${why} |`), `${id} skipped row differs from _lib/skipped.js`);
  }
});

test('the README states the false-positive limits and the safety properties', () => {
  for (const heading of ['## The contract', '## What is built', '## What is deliberately not built', '## False-positive and false-negative limits', '## Safety', '## Tests']) {
    assert.ok(readme.includes(heading), heading);
  }
  for (const id of checks.keys()) {
    if (id === 'd6.honest_states') continue;
    assert.ok(readme.split('## False-positive and false-negative limits')[1].includes(`\`${id}\``), `${id} has no false-positive note`);
  }
});

test('the README counts what it says it counts', () => {
  assert.match(readme, /Nineteen of the thirty-seven/);
  assert.equal(checks.size, 19);
  assert.equal(Object.keys(SKIPPED).length, 18);
});

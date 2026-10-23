import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { ROOT } from './_helpers.js';

const WORKFLOWS = `${ROOT}.github/workflows/`;
const TESTS = readFileSync(`${WORKFLOWS}tests.yml`, 'utf8');

test('the service is in the tests.yml matrix and in the coverage list', () => {
  assert.match(TESTS, /^\s+- brand-engine$/m);
  assert.match(TESTS, /covered="[^"]*\bbrand-engine\b[^"]*"/);
});

test('no workflow runs the brand engine yet: this increment ships no Action', () => {
  for (const name of readdirSync(WORKFLOWS)) {
    if (name === 'tests.yml') continue;
    assert.ok(!readFileSync(WORKFLOWS + name, 'utf8').includes('brand-engine'), name);
  }
});

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

test('only tests.yml and the reusable brand-assess.yml name the brand engine, and nothing triggers brand-assess.yml by itself', () => {
  for (const name of readdirSync(WORKFLOWS)) {
    if (name === 'tests.yml' || name === 'brand-assess.yml') continue;
    assert.ok(!readFileSync(WORKFLOWS + name, 'utf8').includes('brand-engine'), name);
  }
  const text = readFileSync(`${WORKFLOWS}brand-assess.yml`, 'utf8').replace(/^\s*#.*$/gm, '');
  assert.match(text, /^on:\n  workflow_call:/m);
  assert.ok(!/^\s+(push|pull_request|schedule):/m.test(text));
});

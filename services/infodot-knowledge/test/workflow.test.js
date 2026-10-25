import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REQUIRED_ENV } from '../src/env.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WORKFLOW = readFileSync(`${ROOT}.github/workflows/infodot-knowledge.yml`, 'utf8');
const TESTS = readFileSync(`${ROOT}.github/workflows/tests.yml`, 'utf8');

test('the workflow is manually dispatched only: no schedule, push or pull_request trigger yet', () => {
  assert.match(WORKFLOW, /^on:\n {2}workflow_dispatch:/m);
  assert.doesNotMatch(WORKFLOW, /^\s*schedule:/m);
  assert.doesNotMatch(WORKFLOW, /^\s*(push|pull_request|pull_request_target|workflow_run):/m);
});

test('dry_run is an input and defaults to true', () => {
  assert.match(WORKFLOW, /dry_run:\n(?:\s+.*\n)*?\s+default: true/);
});

test('the three secrets are read from repo secrets, with the contract names; URLs are not secrets', () => {
  assert.match(WORKFLOW, /KNOWLEDGE_SECRET_BRAIN: \$\{\{ secrets\.KNOWLEDGE_SECRET_BRAIN \}\}/);
  assert.match(WORKFLOW, /DOT_MEMORY_TOKEN: \$\{\{ secrets\.DOT_MEMORY_TOKEN \}\}/);
  for (const name of REQUIRED_ENV) assert.ok(WORKFLOW.includes(`${name}:`), name);
  assert.match(WORKFLOW, /INFODOT_URL: https:\/\/infodot\.co\.za/);
  assert.match(WORKFLOW, /DOT_MEMORY_URL: https:\/\/memory\.infodot\.co\.za/);
});

test('the workflow applies only when dry_run is explicitly false', () => {
  assert.match(WORKFLOW, /if \[ "\$DRY_RUN" = "false" \]; then args="--apply"; fi/);
  assert.match(WORKFLOW, /node src\/cli\.js run \$args/);
});

test('least privilege and no persisted checkout credentials', () => {
  assert.match(WORKFLOW, /permissions:\n {2}contents: read/);
  assert.match(WORKFLOW, /persist-credentials: false/);
});

test('the service is in the tests.yml matrix and in the coverage list', () => {
  assert.match(TESTS, /^\s+- infodot-knowledge$/m);
  assert.match(TESTS, /covered="[^"]*\binfodot-knowledge\b[^"]*"/);
});

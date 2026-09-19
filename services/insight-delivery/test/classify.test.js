import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConclusion } from '../src/classify.js';

test('a conclusion that implies a platform change classifies as recommendation', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: true }), 'recommendation');
});

test('a conclusion with no implied change classifies as insight', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: false }), 'insight');
});

test('an ambiguous conclusion (field omitted) defaults to recommendation, the stricter path', () => {
  assert.equal(classifyConclusion({}), 'recommendation');
});

test('an ambiguous conclusion (explicit undefined) also defaults to recommendation', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: undefined }), 'recommendation');
});

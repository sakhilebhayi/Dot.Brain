import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { openMemory, findValid, save, listConflicts } from '../src/memory.js';

const TEST_DB = 'test/tmp-memory.sqlite';

function freshMemory() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  return openMemory(TEST_DB);
}

function validRow(overrides = {}) {
  const now = new Date().toISOString();
  return {
    source: 'https://example.com/page',
    date: now,
    topic: 'South African mining software market',
    market: 'South Africa',
    tier: 'observation',
    finding: 'Example finding text',
    confidence: 0.7,
    supporting_evidence: ['quote from page'],
    related_dot_platform: 'dot-mines',
    recommended_action: null,
    expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    fetched_at: now,
    status: 'structured',
    ...overrides,
  };
}

test('save() persists a row and findValid() retrieves it', () => {
  const mem = freshMemory();
  save(mem, validRow());

  const found = findValid(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.ok(found);
  assert.equal(found.finding, 'Example finding text');
});

test('findValid() returns null for a topic with no findings', () => {
  const mem = freshMemory();
  const found = findValid(mem, { topic: 'nonexistent topic', market: 'South Africa' });
  assert.equal(found, null);
});

test('findValid() ignores expired findings', () => {
  const mem = freshMemory();
  save(mem, validRow({ expiry_date: '2020-01-01' }));

  const found = findValid(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.equal(found, null);
});

test('save() rejects a row missing a required field', () => {
  const mem = freshMemory();
  const row = validRow();
  delete row.source;

  assert.throws(() => save(mem, row), /source/);
});

test('listConflicts() returns all rows for a topic, including differing findings', () => {
  const mem = freshMemory();
  save(mem, validRow({ finding: 'Finding A' }));
  save(mem, validRow({ finding: 'Finding B', source: 'https://example.com/other-page' }));

  const rows = listConflicts(mem, { topic: 'South African mining software market', market: 'South Africa' });
  assert.equal(rows.length, 2);
});

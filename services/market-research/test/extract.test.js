import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractFindings } from '../src/extract.js';

test('extractFindings without an API key returns a pending_extraction row with the raw text preserved', async () => {
  const rows = await extractFindings(
    { text: 'Some raw fetched content.', source: 'https://example.com', topic: 'test topic', market: 'South Africa', relatedPlatform: null },
    { apiKey: null }
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending_extraction');
  assert.equal(rows[0].finding, 'Some raw fetched content.');
  assert.equal(rows[0].source, 'https://example.com');
  assert.equal(rows[0].tier, 'observation');
});

test('extractFindings without an API key never claims a fact/insight/hypothesis tier', async () => {
  const rows = await extractFindings(
    { text: 'Raw content.', source: 'https://example.com', topic: 'test', market: 'South Africa', relatedPlatform: null },
    { apiKey: null }
  );

  // A pending_extraction row is explicitly the lowest-commitment tier
  // (observation: "this text was fetched"), never a higher-confidence
  // tier that hasn't actually been earned by real extraction.
  assert.equal(rows[0].tier, 'observation');
  assert.ok(rows[0].confidence <= 0.3);
});

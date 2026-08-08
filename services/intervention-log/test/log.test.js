import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { openLog, record, listEntries, computeStreak } from '../src/log.js';

const TEST_DB = 'test/tmp-log.sqlite';

function freshLog() {
  if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  return openLog(TEST_DB);
}

function validEntry(overrides = {}) {
  return {
    entity: 'Dot.Finance',
    platform: null,
    category: 'routine',
    occurred_at: '2026-08-01T10:00:00.000Z',
    problem: 'Reserve runway dashboard showed stale data',
    trigger: 'Owner noticed the number had not changed in 3 days',
    root_cause: 'Scheduled recompute job was never wired to a cron entry',
    why_automation_failed: 'This was never automated -- the recompute was always manual',
    recommended_permanent_solution: 'Add a daily scheduled task that recomputes and caches the value',
    decision_required: null,
    time_spent_minutes: 15,
    logged_by: 'session',
    ...overrides,
  };
}

test('record() persists an entry and listEntries() retrieves it', () => {
  const log = freshLog();
  record(log, validEntry());

  const rows = listEntries(log, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].problem, 'Reserve runway dashboard showed stale data');
  assert.equal(rows[0].category, 'routine');
});

test('record() rejects an entry missing a required field', () => {
  const log = freshLog();
  const entry = validEntry();
  delete entry.root_cause;

  assert.throws(() => record(log, entry), /root_cause/);
});

test('record() rejects an invalid category', () => {
  const log = freshLog();
  assert.throws(() => record(log, validEntry({ category: 'urgent' })), /category/);
});

test('record() rejects an invalid logged_by', () => {
  const log = freshLog();
  assert.throws(() => record(log, validEntry({ logged_by: 'nobody' })), /logged_by/);
});

test('listEntries() filters by entity', () => {
  const log = freshLog();
  record(log, validEntry({ entity: 'Dot.Finance' }));
  record(log, validEntry({ entity: 'Dot.Billing' }));

  const rows = listEntries(log, { entity: 'Dot.Billing' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity, 'Dot.Billing');
});

test('listEntries() filters by since-date', () => {
  const log = freshLog();
  record(log, validEntry({ occurred_at: '2026-01-01T00:00:00.000Z' }));
  record(log, validEntry({ occurred_at: '2026-08-01T00:00:00.000Z' }));

  const rows = listEntries(log, { since: '2026-06-01' });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].occurred_at, '2026-08-01T00:00:00.000Z');
});

test('computeStreak() on an empty log reports zero history, no fabricated streak', () => {
  const log = freshLog();
  const streak = computeStreak(log, {});
  assert.equal(streak.currentStreakDays, 0);
  assert.equal(streak.longestStreakDays, 0);
});

test('computeStreak() with only strategic entries reports the streak unbroken since logging began', () => {
  const log = freshLog();
  const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
  record(log, validEntry({ category: 'strategic', occurred_at: tenDaysAgo }));

  const streak = computeStreak(log, {});
  assert.ok(streak.currentStreakDays >= 9);
  assert.equal(streak.longestStreakDays, streak.currentStreakDays);
});

test('computeStreak() breaks only on routine entries, not strategic ones', () => {
  const log = freshLog();
  const twentyDaysAgo = new Date(Date.now() - 20 * 86400000).toISOString();
  const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString();
  record(log, validEntry({ category: 'strategic', occurred_at: twentyDaysAgo }));
  record(log, validEntry({ category: 'routine', occurred_at: fiveDaysAgo }));

  const streak = computeStreak(log, {});
  assert.ok(streak.currentStreakDays >= 4 && streak.currentStreakDays <= 5);
  assert.ok(streak.longestStreakDays >= 14);
});

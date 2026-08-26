import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, recordReachability, reachabilityFor } from '../src/store.js';

/**
 * The guardian's sqlite state survives between runs on actions/cache, so an
 * EXISTING database is the normal case in production. CREATE TABLE IF NOT
 * EXISTS silently does nothing to a table that is already there, so a new
 * column has to be migrated in or every query touching it throws.
 */
test('a database created before first_failure_at existed is migrated on open', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'guardian-migrate-')), 'guardian.sqlite');

  // Exactly the shape shipped in the previous release.
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE reachability (
      platform TEXT PRIMARY KEY,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_kind TEXT,
      last_seen_at TEXT
    );
  `);
  legacy.prepare(
    'INSERT INTO reachability (platform, consecutive_failures, last_kind, last_seen_at) VALUES (?, ?, ?, ?)',
  ).run('dot-mines', 2, 'access', '2026-08-26T14:00:49.000Z');
  legacy.close();

  const store = openStore(path);

  const columns = store.prepare('PRAGMA table_info(reachability)').all().map((c) => c.name);
  assert.ok(columns.includes('first_failure_at'), 'the column should have been added');

  // Pre-existing rows survive, with the new column null.
  const existing = reachabilityFor(store, 'dot-mines');
  assert.equal(existing.consecutive_failures, 2, 'existing state must not be wiped');
  assert.equal(existing.last_kind, 'access');
  assert.equal(existing.first_failure_at, null);

  // And a row with a null clock still behaves: the next failure adopts now
  // as the start of the run rather than throwing or producing NaN.
  const next = recordReachability(store, 'dot-mines', {
    ok: false, kind: 'unreachable', at: new Date('2026-08-26T15:00:00Z'),
  });
  assert.equal(next.streak, 3);
  assert.equal(next.firstFailureAt, '2026-08-26T15:00:00.000Z');
  assert.equal(next.elapsedMs, 0);
  assert.ok(Number.isFinite(next.elapsedMs));
});

test('migrating is idempotent and safe on a database that is already current', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'guardian-migrate-')), 'guardian.sqlite');

  const first = openStore(path);
  recordReachability(first, 'dot-mines', { ok: false, kind: 'unreachable', at: new Date('2026-08-26T10:00:00Z') });
  first.close();

  const reopened = openStore(path);
  const columns = reachabilityFor(reopened, 'dot-mines');
  assert.equal(columns.consecutive_failures, 1, 'reopening must not reset state');
  assert.equal(columns.first_failure_at, '2026-08-26T10:00:00.000Z');

  const third = openStore(path);
  assert.equal(reachabilityFor(third, 'dot-mines').consecutive_failures, 1);
});

test('a fresh database gets the column without needing the migration', () => {
  const store = openStore(join(mkdtempSync(join(tmpdir(), 'guardian-fresh-')), 'guardian.sqlite'));
  const columns = store.prepare('PRAGMA table_info(reachability)').all().map((c) => c.name);

  assert.ok(columns.includes('first_failure_at'));
});

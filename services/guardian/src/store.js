import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_uid TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  check_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  attempts INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  resolved_at TEXT,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  incident_uid TEXT,
  kind TEXT NOT NULL,
  workflow TEXT,
  pre_sha TEXT,
  head_sha TEXT,
  triggered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS breaker (
  platform TEXT PRIMARY KEY,
  state TEXT NOT NULL DEFAULT 'closed',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  reason TEXT
);
CREATE TABLE IF NOT EXISTS memory_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  queued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  incident_uid TEXT NOT NULL,
  platform TEXT NOT NULL,
  reason TEXT NOT NULL,
  issue_url TEXT,
  raised_at TEXT NOT NULL
);
`;

/** Statuses that mean "this incident is still being worked". */
export const ACTIVE_STATUSES = ['open', 'remediating'];

export function openStore(dbPath) {
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function newIncidentUid(platform, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `grd-${platform}-${stamp}-${randomBytes(2).toString('hex')}`;
}

export function activeIncidentForCheck(store, platform, checkKey) {
  const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');
  return store.prepare(
    `SELECT * FROM incidents WHERE platform = ? AND check_key = ? AND status IN (${placeholders})
     ORDER BY id DESC LIMIT 1`,
  ).get(platform, checkKey, ...ACTIVE_STATUSES) ?? null;
}

export function insertIncident(store, { incident_uid, platform, check_key, signature, severity, detail }, now = new Date()) {
  const iso = now.toISOString();
  store.prepare(
    `INSERT INTO incidents (incident_uid, platform, check_key, signature, severity, first_seen, last_seen, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(incident_uid, platform, check_key, signature, severity, iso, iso, JSON.stringify(detail ?? null));
  return getIncident(store, incident_uid);
}

export function getIncident(store, incidentUid) {
  return store.prepare('SELECT * FROM incidents WHERE incident_uid = ?').get(incidentUid) ?? null;
}

export function touchIncident(store, incidentUid, { severity, detail } = {}, now = new Date()) {
  const current = getIncident(store, incidentUid);
  if (!current) {
    return null;
  }
  store.prepare(
    'UPDATE incidents SET last_seen = ?, severity = ?, detail = ? WHERE incident_uid = ?',
  ).run(
    now.toISOString(),
    severity ?? current.severity,
    detail === undefined ? current.detail : JSON.stringify(detail),
    incidentUid,
  );
  return getIncident(store, incidentUid);
}

export function setIncidentStatus(store, incidentUid, status, now = new Date()) {
  const resolvedAt = ['resolved', 'rolled_back', 'escalated'].includes(status) ? now.toISOString() : null;
  store.prepare(
    'UPDATE incidents SET status = ?, last_seen = ?, resolved_at = COALESCE(?, resolved_at) WHERE incident_uid = ?',
  ).run(status, now.toISOString(), resolvedAt, incidentUid);
  return getIncident(store, incidentUid);
}

export function incrementAttempts(store, incidentUid) {
  store.prepare('UPDATE incidents SET attempts = attempts + 1 WHERE incident_uid = ?').run(incidentUid);
  return getIncident(store, incidentUid);
}

export function listIncidents(store, { platform, statuses } = {}) {
  const clauses = [];
  const args = [];
  if (platform) {
    clauses.push('platform = ?');
    args.push(platform);
  }
  if (statuses && statuses.length > 0) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    args.push(...statuses);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  return store.prepare(`SELECT * FROM incidents ${where} ORDER BY id DESC`).all(...args);
}

export function recordDeployment(store, { platform, incident_uid, kind, workflow, pre_sha, head_sha }, now = new Date()) {
  store.prepare(
    `INSERT INTO deployments (platform, incident_uid, kind, workflow, pre_sha, head_sha, triggered_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(platform, incident_uid ?? null, kind, workflow ?? null, pre_sha ?? null, head_sha ?? null, now.toISOString());
}

export function deploymentsSince(store, platform, sinceIso) {
  return store.prepare(
    'SELECT * FROM deployments WHERE platform = ? AND triggered_at >= ? ORDER BY id DESC',
  ).all(platform, sinceIso);
}

export function lastDeployment(store, platform) {
  return store.prepare(
    'SELECT * FROM deployments WHERE platform = ? ORDER BY id DESC LIMIT 1',
  ).get(platform) ?? null;
}

export function breakerFor(store, platform) {
  return store.prepare('SELECT * FROM breaker WHERE platform = ?').get(platform)
    ?? { platform, state: 'closed', consecutive_failures: 0, opened_at: null, reason: null };
}

/**
 * Track post-deploy verification outcomes; two consecutive failures open
 * the breaker, which then stays open until a human runs `guardian reset`.
 */
export function recordVerification(store, platform, ok, now = new Date()) {
  const current = breakerFor(store, platform);
  if (ok) {
    store.prepare(
      `INSERT INTO breaker (platform, state, consecutive_failures) VALUES (?, 'closed', 0)
       ON CONFLICT(platform) DO UPDATE SET consecutive_failures = 0
         WHERE breaker.state != 'open'`,
    ).run(platform);
    return breakerFor(store, platform);
  }
  const failures = current.consecutive_failures + 1;
  const opens = failures >= 2;
  store.prepare(
    `INSERT INTO breaker (platform, state, consecutive_failures, opened_at, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET
       state = excluded.state,
       consecutive_failures = excluded.consecutive_failures,
       opened_at = COALESCE(excluded.opened_at, breaker.opened_at),
       reason = COALESCE(excluded.reason, breaker.reason)`,
  ).run(
    platform,
    opens ? 'open' : 'closed',
    failures,
    opens ? now.toISOString() : null,
    opens ? 'two consecutive failed post-deploy verifications' : null,
  );
  return breakerFor(store, platform);
}

export function resetBreaker(store, platform) {
  store.prepare(
    `INSERT INTO breaker (platform, state, consecutive_failures, opened_at, reason)
     VALUES (?, 'closed', 0, NULL, NULL)
     ON CONFLICT(platform) DO UPDATE SET state='closed', consecutive_failures=0, opened_at=NULL, reason=NULL`,
  ).run(platform);
}

export function queueMemoryWrite(store, method, path, body, now = new Date()) {
  store.prepare(
    'INSERT INTO memory_outbox (method, path, body, queued_at) VALUES (?, ?, ?, ?)',
  ).run(method, path, JSON.stringify(body), now.toISOString());
}

export function listMemoryOutbox(store) {
  return store.prepare('SELECT * FROM memory_outbox ORDER BY id ASC').all();
}

export function deleteMemoryOutbox(store, id) {
  store.prepare('DELETE FROM memory_outbox WHERE id = ?').run(id);
}

export function recordEscalation(store, { incident_uid, platform, reason, issue_url }, now = new Date()) {
  store.prepare(
    'INSERT INTO escalations (incident_uid, platform, reason, issue_url, raised_at) VALUES (?, ?, ?, ?, ?)',
  ).run(incident_uid, platform, reason, issue_url ?? null, now.toISOString());
}

export function hasEscalation(store, incidentUid) {
  return store.prepare('SELECT COUNT(*) AS n FROM escalations WHERE incident_uid = ?').get(incidentUid).n > 0;
}

export function listEscalations(store, platform) {
  return platform
    ? store.prepare('SELECT * FROM escalations WHERE platform = ? ORDER BY id DESC').all(platform)
    : store.prepare('SELECT * FROM escalations ORDER BY id DESC').all();
}

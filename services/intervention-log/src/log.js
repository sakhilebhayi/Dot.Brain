import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const REQUIRED_FIELDS = [
  'entity', 'category', 'problem', 'trigger', 'root_cause',
  'why_automation_failed', 'recommended_permanent_solution', 'logged_by',
];

const VALID_CATEGORIES = ['routine', 'strategic'];
const VALID_LOGGED_BY = ['session', 'owner'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS intervention_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  platform TEXT,
  category TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  problem TEXT NOT NULL,
  trigger TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  why_automation_failed TEXT NOT NULL,
  recommended_permanent_solution TEXT NOT NULL,
  decision_required TEXT,
  time_spent_minutes INTEGER,
  logged_by TEXT NOT NULL,
  logged_at TEXT NOT NULL
);
`;

export function openLog(dbPath) {
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function record(log, entry) {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] === undefined || entry[field] === null || entry[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }
  if (!VALID_CATEGORIES.includes(entry.category)) {
    throw new Error(`Invalid category: "${entry.category}" -- must be one of ${VALID_CATEGORIES.join(', ')}`);
  }
  if (!VALID_LOGGED_BY.includes(entry.logged_by)) {
    throw new Error(`Invalid logged_by: "${entry.logged_by}" -- must be one of ${VALID_LOGGED_BY.join(', ')}`);
  }

  const occurredAt = entry.occurred_at ?? new Date().toISOString();
  const loggedAt = new Date().toISOString();

  const stmt = log.prepare(`
    INSERT INTO intervention_log (
      entity, platform, category, occurred_at, problem, trigger, root_cause,
      why_automation_failed, recommended_permanent_solution, decision_required,
      time_spent_minutes, logged_by, logged_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    entry.entity,
    entry.platform ?? null,
    entry.category,
    occurredAt,
    entry.problem,
    entry.trigger,
    entry.root_cause,
    entry.why_automation_failed,
    entry.recommended_permanent_solution,
    entry.decision_required ?? null,
    entry.time_spent_minutes ?? null,
    entry.logged_by,
    loggedAt
  );
}

export function listEntries(log, { entity, since } = {}) {
  let sql = 'SELECT * FROM intervention_log WHERE 1=1';
  const params = [];
  if (entity) {
    sql += ' AND entity = ?';
    params.push(entity);
  }
  if (since) {
    sql += ' AND occurred_at >= ?';
    params.push(since);
  }
  sql += ' ORDER BY occurred_at DESC';
  const stmt = log.prepare(sql);
  return stmt.all(...params);
}

export function computeStreak(log, { entity } = {}) {
  const rows = listEntries(log, { entity }).slice().reverse(); // oldest first

  if (rows.length === 0) {
    return { currentStreakDays: 0, longestStreakDays: 0 };
  }

  const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
  const now = new Date().toISOString();
  const loggingStarted = rows[0].occurred_at;

  let longestStreakDays = 0;
  let segmentStart = loggingStarted;

  for (const row of rows) {
    if (row.category === 'routine') {
      longestStreakDays = Math.max(longestStreakDays, daysBetween(segmentStart, row.occurred_at));
      segmentStart = row.occurred_at;
    }
  }
  longestStreakDays = Math.max(longestStreakDays, daysBetween(segmentStart, now));

  const currentStreakDays = daysBetween(segmentStart, now);

  return { currentStreakDays, longestStreakDays };
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const REQUIRED_FIELDS = [
  'source', 'date', 'topic', 'market', 'tier', 'finding',
  'confidence', 'expiry_date', 'fetched_at', 'status',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  date TEXT NOT NULL,
  topic TEXT NOT NULL,
  market TEXT NOT NULL,
  tier TEXT NOT NULL,
  finding TEXT NOT NULL,
  confidence REAL NOT NULL,
  supporting_evidence TEXT,
  related_dot_platform TEXT,
  recommended_action TEXT,
  expiry_date TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  status TEXT NOT NULL
);
`;

export function openMemory(dbPath) {
  const dir = dirname(dbPath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  return db;
}

export function save(memory, row) {
  for (const field of REQUIRED_FIELDS) {
    if (row[field] === undefined || row[field] === null || row[field] === '') {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  const stmt = memory.prepare(`
    INSERT INTO findings (id, source, date, topic, market, tier, finding, confidence, supporting_evidence, related_dot_platform, recommended_action, expiry_date, fetched_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    randomUUID(),
    row.source, row.date, row.topic, row.market, row.tier, row.finding, row.confidence,
    JSON.stringify(row.supporting_evidence ?? []),
    row.related_dot_platform ?? null,
    row.recommended_action ?? null,
    row.expiry_date, row.fetched_at, row.status
  );
}

export function findValid(memory, { topic, market }) {
  const today = new Date().toISOString().slice(0, 10);
  const stmt = memory.prepare(`
    SELECT * FROM findings
    WHERE topic = ? AND market = ? AND expiry_date >= ?
    ORDER BY fetched_at DESC
    LIMIT 1
  `);
  const row = stmt.get(topic, market, today);
  return row ?? null;
}

export function listConflicts(memory, { topic, market }) {
  const stmt = memory.prepare(`
    SELECT * FROM findings WHERE topic = ? AND market = ? ORDER BY fetched_at DESC
  `);
  return stmt.all(topic, market);
}

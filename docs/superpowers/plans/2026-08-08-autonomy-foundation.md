# Autonomy Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `brain.autonomy.md` (the classification/scoring/honesty contract) and `services/intervention-log/` (the CLI that makes owner dependency measurable), fully registered in Dot.Brain's own navigation surfaces.

**Architecture:** One documentation file following the existing `brain.*.md` front-matter/change-log convention, plus one sibling Node service under `services/` mirroring `services/market-research/`'s shape exactly (`node:sqlite`, zero dependencies, `node --test`).

**Tech Stack:** Node.js ≥ 22.5.0, `node:sqlite` (experimental), `node:test` + `node:assert/strict`.

## Global Constraints

- Score weights (verbatim from spec §3): Governance 10%, Operations 10%, Technology 10%, Marketing 10%, Sales 10%, Customer Experience 10%, Finance 10%, Security 10%, Resilience 10%, Knowledge 5%, Learning 5%.
- An unmeasured category scores **0** and is never excluded from the weighted average.
- A score is computed per entity (Houz of Sax, BluPin, Dot, each platform) — never one blended ecosystem number.
- Interval sequence (days): 1 → 3 → 7 → 14 → 30 → 60 → 90 → 120 → 180 → 270 → 365 → Continuous.
- Gates: Green ≥ 90, Yellow 75–89, Red < 75.
- A `routine` Owner Intervention Log entry resets the streak; a `strategic` one does not.
- Every `intervention_log` row requires: `entity`, `category` (`routine`|`strategic`), `problem`, `trigger`, `root_cause`, `why_automation_failed`, `recommended_permanent_solution`, `logged_by` (`session`|`owner`).
- No fabricated scores, streaks, or maturity — an entry, category, or score that has no real signal says so; it is never invented.

---

### Task 1: `brain.autonomy.md`

**Files:**
- Create: `brain.autonomy.md`

**Interfaces:**
- Produces: the canonical definitions every later sub-project (platform classification audits, a future dashboard) cites by section number — §1 Organisational boundaries, §2 Three-level classification, §3 Autonomy Score, §4 Per-entity scoring, §5 Intervals/gates, §6 Owner-Free Operating Streak, §7 Never-hide-a-weak-entity rule, §8 Owner Intervention Log content requirements, §9 Anti-fabrication rules.

- [ ] **Step 1: Write the document**

Create `brain.autonomy.md` with this exact content:

```markdown
---
title: Dot.Brain — Autonomy Foundation (Owner Independence Classification & Measurement)
version: 1.0.0
status: draft
owners: [Business Agent]
last-review: 2026-08-08
---

# brain.autonomy — Autonomy Foundation

Purpose: the shared contract for the ecosystem-wide Owner Independence program spanning Houz of Sax Trust → BluPin → Dot → individual Dot platforms. Defines what "autonomous" means, how it is classified, how it is scored, and the honesty rules that bind every future sub-project built against this contract. This document defines vocabulary and rules; it does not itself classify any real process — that is future, platform-by-platform work.

> **Related documents:**
> - [brain.governance.md](brain.governance.md) — the approval-tier framework this document's Level 2/3 escalation borrows its shape from, without inheriting its agent-colony machinery.
> - [brain.cushion.md](brain.cushion.md) — the sibling honesty pattern (`insufficient_data` over fabrication) this document's §3 unmeasured-category rule follows.
> - [brain.platforms.md](brain.platforms.md) — the platform registry; per-platform classification audits (future work) live in `platforms/<platform>.md`, registered there.

---

## §1 Organisational boundaries

Houz of Sax Trust, BluPin, Dot, each individual Dot platform, customers, and external partners are separate entities. Nothing built against this contract may blur, across those boundaries: ownership, governance, financial accounts, legal entity, data ownership, permissions, liability, or regulatory responsibility. Any future capability that moves data or authority across an entity boundary must name the boundary it crosses explicitly in its own spec — this document does not pre-authorize any cross-entity access.

## §2 Three-level autonomy classification

Every process, on every platform and in every entity, is classified as exactly one of:

- **Level 1 — Autonomous.** Executes without owner approval. Examples: routine marketing, content research, SEO, monitoring, reporting, lead qualification, onboarding, routine support, internal task management, documentation, diagnostics, safe automated remediation, routine analytics.
- **Level 2 — Escalate.** The system analyses and prepares the action but requires authorised human approval before it executes. Every Level 2 proposal presents, in order: Context → Evidence → Risk → Recommendation → Proposed Action. Examples: significant spending, pricing changes, partnerships, contract changes, high-value sales, sensitive customer communications, material resource allocation, significant hiring.
- **Level 3 — Human Control.** The owner holds explicit, non-delegable authority. Nothing built under this program may execute these autonomously. Examples: legal ownership, trust/fiduciary decisions, banking authority, major financial commitments, regulatory submissions, legal agreements, security credential ownership, destructive operations, permanent deletion, strategic direction, major corporate restructuring.

A process's classification is a property of the process, recorded wherever that process is implemented (e.g. a platform's `platforms/<name>.md` states which of its real processes are L1 vs L2 vs L3). This document is the shared vocabulary, not a registry — no central list is maintained here.

## §3 Autonomy Score

Weighted categories (sum to 100%):

| Category | Weight |
|---|---:|
| Governance | 10% |
| Operations | 10% |
| Technology | 10% |
| Marketing | 10% |
| Sales | 10% |
| Customer Experience | 10% |
| Finance | 10% |
| Security | 10% |
| Resilience | 10% |
| Knowledge | 5% |
| Learning | 5% |

**Honesty rule, binding on every future consumer of this formula:** a category with no real underlying signal scores **0** for that entity, full stop. It is never excluded from the weighted average and never assigned a default, neutral, or estimated value. A dashboard may (and should) visually distinguish "0 — capability does not exist yet" from "0 — capability exists and is failing," but both contribute 0 to the number. Excluding unmeasured categories from the denominator would let a barely-started entity's score overstate its real maturity — the exact failure §7 exists to prevent.

## §4 Per-entity scoring

A score is computed separately for Houz of Sax Trust, BluPin, Dot (the ecosystem layer), and each individual Dot platform. There is no single blended "ecosystem score" that a strong entity's number can average out a weak one behind. An ecosystem-level view (a future dashboard) presents all scores side by side, never collapsed to one figure.

## §5 Autonomy intervals and gates

Progression sequence (days): 1 → 3 → 7 → 14 → 30 → 60 → 90 → 120 → 180 → 270 → 365 → Continuous. An entity advances to the next interval only after passing the gate for its current one:

- **Green — advance:** Autonomy Score ≥ 90, no unresolved critical incident, no major security failure, no uncontrolled financial loss, no critical customer failure, owner interventions below threshold, required monitoring operational, recovery procedures tested.
- **Yellow — repeat:** Score 75–89, minor recurring failures, owner dependency still too high, or important automation gaps remain. Repeat the same interval.
- **Red — reduce:** Score < 75, a critical incident occurred, security controls failed, material financial exposure occurred, a customer-critical process failed, or owner intervention became routine. Drop to a shorter interval.

A failure is never hidden to preserve a gate result or advance the schedule.

## §6 Owner-Free Operating Streak

Once an entity has real interval history, it gets a streak: current consecutive days without a **routine** owner intervention, and the longest streak on record. A **strategic** intervention (the owner making a Level 3 decision, or reviewing/approving a Level 2 escalation the system correctly routed to them) does **not** reset the streak — that's the system working as designed. A **routine** intervention (the owner doing something a Level 1 process should have handled, or being pulled in because automation failed) resets it to zero. This classification is recorded on each Owner Intervention Log entry (§8).

## §7 Never hide a weak entity behind a strong one

Restates §4 as a standing rule: ecosystem-wide reporting must always surface every entity's individual score. A high Dot-platform average must never be presented in a way that obscures a Houz of Sax or BluPin score of 0.

## §8 Owner Intervention Log — what it is for

The mechanism that makes owner dependency measurable at all. Every time the owner has to act on something that was expected to run autonomously (or approve something a well-functioning Level 2 process routed to them), an entry gets recorded — by a Claude session doing the work, or by the owner directly for interventions that happened outside any session. Implemented in `services/intervention-log/` (see its own README for the CLI). A valid entry requires:

- **entity** — which of Houz of Sax / BluPin / Dot / a specific platform name this intervention concerned.
- **category** — `routine` or `strategic` (drives §6).
- **problem, trigger, root_cause** — what happened and why, in enough detail that a later session can act on it without re-investigating.
- **why_automation_failed** — required even when the honest answer is "this was never automated" — that answer is itself the signal this program exists to surface.
- **recommended_permanent_solution** — the point of logging an intervention is to eventually stop needing it; every entry proposes how.

## §9 Anti-fabrication rules (binding on this entire program)

Never fake revenue, customers, or engagement; never manufacture testimonials; never hide failures, manipulate metrics, or suppress incidents; never mark incomplete work complete; never treat agent activity itself as business success. The objective of every sub-project under this program is to **discover** whether autonomy exists, not to **prove** that it does.

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-08 | Autonomy Foundation sub-project | Initial contract: organisational boundaries, three-level classification, Autonomy Score formula with unmeasured-category-scores-zero rule, per-entity scoring, interval/gate thresholds, Owner-Free Operating Streak rule, Owner Intervention Log content requirements, anti-fabrication rules. |

## Open Questions

- Should platform-level Level 1/2/3 classification live as a new section inside each existing `platforms/<name>.md`, or as a separate file? (Deferred to the classification-audit sub-project.)
```

- [ ] **Step 2: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add brain.autonomy.md
git commit -m "docs: add brain.autonomy.md — Autonomy Foundation contract

Classification levels, Autonomy Score formula (unmeasured category = 0,
never excluded), per-entity scoring, interval/gate thresholds, streak
rule, Owner Intervention Log content requirements, anti-fabrication
rules. First document of the ecosystem-wide Owner Independence program."
```

---

### Task 2: `services/intervention-log/` — schema + `log.js`

**Files:**
- Create: `services/intervention-log/package.json`
- Create: `services/intervention-log/.gitignore`
- Create: `services/intervention-log/src/log.js`
- Create: `services/intervention-log/test/log.test.js`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `openLog(dbPath) -> DatabaseSync`, `record(log, entry) -> void` (throws `Error` naming the first invalid/missing field), `listEntries(log, {entity, since}) -> Array<row>` (both filters optional, newest `logged_at` first), `computeStreak(log, {entity}) -> {currentStreakDays, longestStreakDays}` (`entity` optional). Task 3's `cli.js` imports all four by name from `./log.js`.

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@dot-brain/intervention-log",
  "version": "1.0.0",
  "description": "Owner Intervention Log -- records when the owner had to act on something a Dot ecosystem entity was expected to handle autonomously. See ../../brain.autonomy.md §8 for the full contract.",
  "type": "module",
  "bin": {
    "intervention-log": "./src/cli.js"
  },
  "scripts": {
    "test": "node --experimental-sqlite --test"
  },
  "engines": {
    "node": ">=22.5.0"
  }
}
```

- [ ] **Step 2: `.gitignore`**

```
data/
node_modules/
test/tmp-*.sqlite
```

- [ ] **Step 3: Write the failing test**

Create `services/intervention-log/test/log.test.js`:

```javascript
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd services/intervention-log && npm test`
Expected: FAIL — `Cannot find module '../src/log.js'`

- [ ] **Step 5: Write `src/log.js`**

```javascript
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd services/intervention-log && npm test`
Expected: PASS (9 tests)

- [ ] **Step 7: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add services/intervention-log/package.json services/intervention-log/.gitignore \
  services/intervention-log/src/log.js services/intervention-log/test/log.test.js
git commit -m "feat: intervention-log schema + log.js (record/list/streak)

openLog/record/listEntries/computeStreak, mirroring services/market-research's
node:sqlite pattern. computeStreak breaks only on routine entries per
brain.autonomy.md §6; an empty log reports zero history rather than a
fabricated streak."
```

---

### Task 3: `services/intervention-log/` — CLI + README + manual verification

**Files:**
- Create: `services/intervention-log/src/cli.js`
- Create: `services/intervention-log/README.md`

**Interfaces:**
- Consumes: `openLog`, `record`, `listEntries`, `computeStreak` from `../src/log.js` (Task 2).

- [ ] **Step 1: Write `src/cli.js`**

```javascript
#!/usr/bin/env node
import { openLog, record, listEntries, computeStreak } from './log.js';

function parseFlags(argv) {
  const flags = {};
  for (const arg of argv) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) {
      const key = match[1].replace(/-/g, '_');
      flags[key] = match[2];
    }
  }
  return flags;
}

function requireFlags(flags, names) {
  const missing = names.filter((name) => flags[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required flag(s): ${missing.map((n) => `--${n.replace(/_/g, '-')}`).join(', ')}`);
  }
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const log = openLog(new URL('../data/intervention-log.sqlite', import.meta.url).pathname);

  if (command === 'log') {
    requireFlags(flags, [
      'entity', 'category', 'problem', 'trigger', 'root_cause',
      'why_automation_failed', 'recommended_solution', 'logged_by',
    ]);
    record(log, {
      entity: flags.entity,
      platform: flags.platform ?? null,
      category: flags.category,
      problem: flags.problem,
      trigger: flags.trigger,
      root_cause: flags.root_cause,
      why_automation_failed: flags.why_automation_failed,
      recommended_permanent_solution: flags.recommended_solution,
      decision_required: flags.decision_required ?? null,
      time_spent_minutes: flags.time_spent_minutes ? Number(flags.time_spent_minutes) : null,
      logged_by: flags.logged_by,
    });
    console.log(`Logged ${flags.category} intervention for ${flags.entity}.`);
    return;
  }

  if (command === 'list') {
    const rows = listEntries(log, { entity: flags.entity, since: flags.since });
    if (rows.length === 0) {
      console.log('No intervention log entries.');
      return;
    }
    for (const row of rows) {
      console.log(`[${row.occurred_at}] ${row.entity}${row.platform ? ` (${row.platform})` : ''} -- ${row.category} -- ${row.problem}`);
    }
    return;
  }

  if (command === 'streak') {
    const { currentStreakDays, longestStreakDays } = computeStreak(log, { entity: flags.entity });
    console.log(`Current streak: ${currentStreakDays} day(s)`);
    console.log(`Longest streak: ${longestStreakDays} day(s)`);
    return;
  }

  console.error('Usage:');
  console.error('  intervention-log log --entity=<name> [--platform=<name>] --category=<routine|strategic> \\');
  console.error('    --problem="<text>" --trigger="<text>" --root-cause="<text>" \\');
  console.error('    --why-automation-failed="<text>" --recommended-solution="<text>" \\');
  console.error('    [--decision-required="<text>"] [--time-spent-minutes=<n>] --logged-by=<session|owner>');
  console.error('  intervention-log list [--entity=<name>] [--since=<ISO date>]');
  console.error('  intervention-log streak [--entity=<name>]');
  process.exit(1);
}

try {
  main();
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Owner Intervention Log

Records when the owner had to act on something a Dot ecosystem entity was
expected to handle autonomously. See `../../brain.autonomy.md` §8 for the
full contract this implements.

## Usage

```bash
npm install  # first time only, no dependencies to fetch but sets up node_modules/
node src/cli.js log --entity="Dot.Finance" --category=routine \
  --problem="Reserve runway dashboard showed stale data" \
  --trigger="Owner noticed the number had not changed in 3 days" \
  --root-cause="Scheduled recompute job was never wired to a cron entry" \
  --why-automation-failed="This was never automated -- the recompute was always manual" \
  --recommended-solution="Add a daily scheduled task that recomputes and caches the value" \
  --logged-by=session

node src/cli.js list --entity="Dot.Finance"
node src/cli.js streak
```

## What's implemented

- `log` — records one intervention. All of `entity`, `category`, `problem`,
  `trigger`, `root-cause`, `why-automation-failed`, `recommended-solution`,
  `logged-by` are required; `platform`, `decision-required`,
  `time-spent-minutes` are optional.
- `list` — chronological view, optionally filtered by `--entity` and/or
  `--since` (ISO date, matches on `occurred_at`).
- `streak` — current and longest consecutive-days-without-a-routine-entry,
  optionally scoped to one `--entity`. An empty log reports `0`/`0` rather
  than a fabricated streak.

## What's NOT implemented

- No Autonomy Score computation — that requires real per-category signals
  this service doesn't produce (see `brain.autonomy.md` §3).
- No dashboard or UI — this is a CLI only.
- No automatic detection of interventions — every entry is asserted by a
  Claude session or the owner; nothing here infers that an intervention
  happened.
```

- [ ] **Step 3: Manual end-to-end verification**

```bash
cd services/intervention-log
npm install
node src/cli.js log --entity="Dot.Finance" --category=routine \
  --problem="Test problem" --trigger="Test trigger" --root-cause="Test cause" \
  --why-automation-failed="Never automated" --recommended-solution="Automate it" \
  --logged-by=session
node src/cli.js list
node src/cli.js streak
```

Expected: `log` prints a confirmation, `list` shows the one entry, `streak`
prints `Current streak: 0 day(s)` / `Longest streak: 0 day(s)` (the entry
is `routine` and occurred just now, so the streak since that break is 0
days old).

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS (9 tests, from Task 2 — Task 3 adds no new automated tests, matching `market-research`'s precedent of CLI verified manually)

- [ ] **Step 5: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add services/intervention-log/src/cli.js services/intervention-log/README.md
git commit -m "feat: intervention-log CLI (log/list/streak) + README + manual verification

Completes services/intervention-log/. Verified end-to-end against a real
SQLite file: log -> list -> streak round-trip."
```

---

### Task 4: Repository registration

**Files:**
- Modify: `README.md`
- Modify: `indexes/INDEX.md`
- Modify: `indexes/CROSSREF.md`
- Modify: `indexes/GLOSSARY.md`

**Interfaces:**
- Consumes: nothing new — this task only adds cross-links to the artifacts Tasks 1–3 already created.

- [ ] **Step 1: `README.md`**

In the annotated repository tree, add a line after the `brain.market_intelligence.md` line (added in the prior truth-reconciliation commit):

```
├── brain.autonomy.md                # Owner Independence classification, scoring, streak, anti-fabrication rules · Business Agent · executives, platform engineers
```

In the `services/` tree entry, add a second line:

```
└── services/                        # Dot.Brain's own runnable code, one directory per brain.*.md that hosts an implementation · Business Agent · Dot.Brain itself
    ├── market-research/             # Implements brain.market_intelligence.md · Business Agent · Dot.Brain itself
    └── intervention-log/            # Implements brain.autonomy.md §8 · Business Agent · Dot.Brain itself
```

In the repository-map Mermaid diagram, bump the document count:

```
    R --> CORE[brain.*.md — 36 core domain documents]
```

In the Document Ownership Matrix, extend the existing cushion/market_intelligence row:

```
| brain.cushion.md, brain.market_intelligence.md, brain.autonomy.md, services/ | Business Agent | Data Agent | Executive Sponsor | Quarterly |
```

Bump `version: 1.5.0` → `version: 1.6.0` in the front-matter, and add a Change Log row:

```
| 1.6.0 | 2026-08-08 | Autonomy Foundation sub-project | Registered brain.autonomy.md and services/intervention-log/ — annotated tree, ownership matrix, document count. |
```

- [ ] **Step 2: `indexes/INDEX.md`**

In the Executive persona reading order, extend the line added in the prior reconciliation commit:

```
4. [../brain.cushion.md](../brain.cushion.md) — shock-absorption capacity per platform · [../brain.market_intelligence.md](../brain.market_intelligence.md) — how research becomes decisions · [../brain.autonomy.md](../brain.autonomy.md) — owner-independence classification and scoring
```

In the Full Document Catalog table, add a new row (this document doesn't fit Operations & Trust or People & Value cleanly — it's the classification layer above both):

```
| Autonomy | brain.autonomy — classification, scoring, streak, anti-fabrication rules for the Owner Independence program |
```

And extend the Runnable Services row:

```
| Runnable Services | services/ — Dot.Brain's own reference implementations of a brain.*.md contract (currently: market-research, intervention-log) |
```

Bump `version: 1.2.0` → `version: 1.3.0`, add Change Log row:

```
| 1.3.0 | 2026-08-08 | Autonomy Foundation sub-project | Registered brain.autonomy.md (Executive reading order + new Autonomy catalog group); added intervention-log to Runnable Services row |
```

- [ ] **Step 3: `indexes/CROSSREF.md`**

Add a row to the per-document reference table (alphabetically near the `brain.cushion.md`/`brain.market_intelligence.md` rows added in the prior reconciliation commit):

```
| [../brain.autonomy.md](../brain.autonomy.md) | Three-level classification (L1/L2/L3), Autonomy Score formula + unmeasured-category-zero rule, per-entity scoring, interval/gate thresholds, streak rule, Owner Intervention Log content requirements | brain.governance (approval-tier shape, not a hard dependency) |
```

Bump `version: 1.0.35` → `version: 1.0.36`, add Change Log row:

```
| 1.0.36 | 2026-08-08 | Autonomy Foundation sub-project | brain.autonomy.md published: row added to §2 |
```

- [ ] **Step 4: `indexes/GLOSSARY.md`**

Add entries in alphabetical position:

In the A–C section (after "Aggregation floor" or wherever alphabetically correct, before "Analysis pack" if "Autonomy" sorts first):

```
| **Autonomy Score** | Weighted 11-category score (see brain.autonomy.md §3); a category with no real signal scores 0 and is never excluded from the average | [../brain.autonomy.md](../brain.autonomy.md) §3 |
```

In the H–M section (alphabetically, "Level 1/2/3" — file under "L"):

```
| **Level 1 / 2 / 3 (autonomy classification)** | Autonomous (no approval needed) / Escalate (prepared, needs human approval) / Human Control (owner has non-delegable authority) | [../brain.autonomy.md](../brain.autonomy.md) §2 |
```

In the N–R section, alphabetically near "Never-forget set" (before it, since "Never-forget" > "Owner" alphabetically... actually "Never" < "Owner", so after "Never-forget set"):

```
| **Owner Intervention Log** | Records every time the owner acts on something an entity was expected to handle autonomously; entity/category/problem/trigger/root_cause/why_automation_failed/recommended_permanent_solution required on every entry | [../brain.autonomy.md](../brain.autonomy.md) §8, implementation [../services/intervention-log/](../services/intervention-log/) |
| **Owner-Free Operating Streak** | Consecutive days without a routine owner intervention; a strategic intervention does not reset it, a routine one does | [../brain.autonomy.md](../brain.autonomy.md) §6 |
```

Bump `version: 1.0.2` → `version: 1.0.3`, add Change Log row:

```
| 1.0.3 | 2026-08-08 | Autonomy Foundation sub-project | Added "Autonomy Score", "Level 1 / 2 / 3 (autonomy classification)", "Owner Intervention Log", "Owner-Free Operating Streak" |
```

- [ ] **Step 5: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add README.md indexes/INDEX.md indexes/CROSSREF.md indexes/GLOSSARY.md
git commit -m "docs: register brain.autonomy.md and services/intervention-log/ in repo index

Registered as part of this sub-project's own deliverable, per the mandatory
registration section added to the design spec -- not deferred to a later
truth-reconciliation pass."
```

---

## Self-Review Notes

- **Spec coverage:** Task 1 covers spec §"brain.autonomy.md contents" in full (all 9 subsections mapped 1:1 to spec §1–§9). Task 2+3 cover spec §"services/intervention-log/ — implementation" (schema, `log.js`, `cli.js`, tests) in full. Task 4 covers spec §"Repository registration" in full.
- **Placeholder scan:** none — every step has literal file content.
- **Type consistency:** `record`/`listEntries`/`computeStreak` signatures match between Task 2 (definition) and Task 3 (`cli.js` usage) — checked field names (`entity`, `platform`, `category`, `problem`, `trigger`, `root_cause`, `why_automation_failed`, `recommended_permanent_solution`, `decision_required`, `time_spent_minutes`, `logged_by`) are identical across the test file, `log.js`, and `cli.js`.

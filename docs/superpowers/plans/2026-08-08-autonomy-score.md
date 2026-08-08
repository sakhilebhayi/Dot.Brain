# Autonomy Score Computation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `platforms/autonomy-signals.json` (the structured extraction of the 29 platform audits) and `services/autonomy-score/` (a CLI that computes and prints the Autonomy Score per `brain.autonomy.md` §3's formula, applied via the binary category-formula table from the design spec).

**Architecture:** One hand-built JSON data file (no parser needed — the values were extracted by directly reading the 29 already-committed classification sections) plus one small Node service mirroring `services/market-research/` and `services/intervention-log/`'s established shape (`node:sqlite`-free this time — pure JSON in, computed report out, no persistence needed).

**Tech Stack:** Node.js ≥ 22.5.0, `node:test` + `node:assert/strict`. No new runtime dependencies.

## Global Constraints

- Category weights (verbatim from `brain.autonomy.md` §3): Governance 10%, Operations 10%, Technology 10%, Marketing 10%, Sales 10%, Customer Experience 10%, Finance 10%, Security 10%, Resilience 10%, Knowledge 5%, Learning 5%.
- Every category formula is binary (100 or 0) — never a fabricated continuous scale.
- One real signal feeds exactly one category — never reused across two categories (the double-counting rule from the design spec).
- Houz of Sax Trust and BluPin get explicit all-zero entries — never omitted.
- The 29 platforms' individual scores are always shown; the `dot` ecosystem average is always shown alongside them, never replacing them.
- `dot`'s own entity score (Dot.Brain's own repository) is reported separately from the 29-platform average — they are not the same number.

---

### Task 1: `platforms/autonomy-signals.json`

**Files:**
- Create: `platforms/autonomy-signals.json`

**Interfaces:**
- Produces: the data file `services/autonomy-score/src/score.js` (Task 2) reads. Schema per entity: `{ entity: string, kind: "platform"|"ecosystem-entity", level_1_count: number, level_2_count: number, has_cicd: boolean, has_cushion_dimension: boolean, has_security_ci_check: boolean, verified_infrastructure_pass: boolean, audited_date: string }`.

- [ ] **Step 1: Write the file**

Create `platforms/autonomy-signals.json` with this exact content — every value below was extracted directly from the already-committed `## Autonomy Classification` (and, where present, `## Verified Infrastructure State (2026-08-07)`) sections in each `platforms/<id>.md`, per the design spec's formula table and its one-signal-per-category rule (a platform whose only real workflow is a narrow security/dependency check gets `has_cicd: false` and `has_security_ci_check: true`, not both true from the same artifact):

```json
[
  { "entity": "dot-agents", "kind": "platform", "level_1_count": 4, "level_2_count": 3, "has_cicd": true, "has_cushion_dimension": false, "has_security_ci_check": true, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-analytics", "kind": "platform", "level_1_count": 6, "level_2_count": 0, "has_cicd": true, "has_cushion_dimension": false, "has_security_ci_check": true, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-auction", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-billing", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": true, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-brain", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "dot-central", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-charts", "kind": "platform", "level_1_count": 1, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "dot-design", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-docs", "kind": "platform", "level_1_count": 3, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-dopemine", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-ehail", "kind": "platform", "level_1_count": 1, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-emall", "kind": "platform", "level_1_count": 3, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-engage", "kind": "platform", "level_1_count": 3, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-farms", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-files", "kind": "platform", "level_1_count": 1, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": true, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-finance", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": true, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-forms", "kind": "platform", "level_1_count": 5, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-hr", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-infodot", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": true, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "dot-memory", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-mines", "kind": "platform", "level_1_count": 5, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": true, "has_security_ci_check": true, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "dot-notify", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-plug", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-press", "kind": "platform", "level_1_count": 2, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-projects", "kind": "platform", "level_1_count": 1, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-pulse", "kind": "platform", "level_1_count": 4, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-sheet", "kind": "platform", "level_1_count": 2, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-tasks", "kind": "platform", "level_1_count": 1, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot-tutor", "kind": "platform", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": true, "audited_date": "2026-08-08" },
  { "entity": "dot", "kind": "ecosystem-entity", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "houz-of-sax", "kind": "ecosystem-entity", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" },
  { "entity": "blupin", "kind": "ecosystem-entity", "level_1_count": 0, "level_2_count": 0, "has_cicd": false, "has_cushion_dimension": false, "has_security_ci_check": false, "verified_infrastructure_pass": false, "audited_date": "2026-08-08" }
]
```

Note on the `dot` row: its signals intentionally mirror `dot-agents`... no — mirror `dot-brain`'s row exactly (both represent the same repository, Dot.Brain, audited once). This is documented duplication, not an error: `dot` is the ecosystem-layer entity: `brain.autonomy.md` §4 requires it as a distinct reported row from the 29-platform average (Task 3 computes that average separately), and its only real substance today is Dot.Brain's own repository, which `platforms/dot-brain.md` already audited.

`houz-of-sax` and `blupin` are all-zero/all-false because no code or governance process exists for either yet — stated explicitly here rather than omitted, per `brain.autonomy.md` §7.

- [ ] **Step 2: Validate the JSON parses and has 32 entries**

Run: `node -e "const d = require('./platforms/autonomy-signals.json'); console.log(d.length, d.every(e => typeof e.entity === 'string'));"`
Expected: `32 true`

- [ ] **Step 3: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add platforms/autonomy-signals.json
git commit -m "data: extract autonomy-signals.json from the 29 platform audits

Structured extraction of level_1/2 counts, CI/CD, cushion, security-CI,
and verified-infrastructure-pass signals from the already-committed
platforms/*.md Autonomy Classification sections, plus explicit
all-zero rows for dot (ecosystem layer), Houz of Sax, and BluPin."
```

---

### Task 2: `services/autonomy-score/src/score.js`

**Files:**
- Create: `services/autonomy-score/package.json`
- Create: `services/autonomy-score/src/score.js`
- Create: `services/autonomy-score/test/score.test.js`

**Interfaces:**
- Consumes: entity objects shaped per Task 1's schema.
- Produces: `scoreEntity(signals) -> { categories: { governance: number, operations: number, technology: number, marketing: number, sales: number, customer_experience: number, finance: number, security: number, resilience: number, knowledge: number, learning: number }, total: number }` (each category value is `0` or `100`; `total` is the weighted sum, a number 0–100). `averageScore(scores: number[]) -> number` (unweighted mean, rounded to 1 decimal place).

- [ ] **Step 1: `package.json`**

```json
{
  "name": "@dot-brain/autonomy-score",
  "version": "1.0.0",
  "description": "Computes the Autonomy Score (brain.autonomy.md §3) per entity from platforms/autonomy-signals.json's real signals -- binary per-category formulas, no fabricated continuous scores.",
  "type": "module",
  "bin": {
    "autonomy-score": "./src/cli.js"
  },
  "scripts": {
    "test": "node --test"
  },
  "engines": {
    "node": ">=22.5.0"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `services/autonomy-score/test/score.test.js`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreEntity, averageScore } from '../src/score.js';

function signals(overrides = {}) {
  return {
    entity: 'test-entity',
    kind: 'platform',
    level_1_count: 0,
    level_2_count: 0,
    has_cicd: false,
    has_cushion_dimension: false,
    has_security_ci_check: false,
    verified_infrastructure_pass: false,
    audited_date: '2026-08-08',
    ...overrides,
  };
}

test('scoreEntity() with all-zero signals returns 0 for every category and a total of 0', () => {
  const result = scoreEntity(signals());
  assert.equal(result.categories.governance, 0);
  assert.equal(result.categories.operations, 0);
  assert.equal(result.categories.technology, 0);
  assert.equal(result.categories.marketing, 0);
  assert.equal(result.categories.sales, 0);
  assert.equal(result.categories.customer_experience, 0);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.categories.security, 0);
  assert.equal(result.categories.resilience, 0);
  assert.equal(result.categories.knowledge, 0);
  assert.equal(result.categories.learning, 0);
  assert.equal(result.total, 0);
});

test('scoreEntity() sets governance to 100 only when level_2_count > 0', () => {
  const result = scoreEntity(signals({ level_2_count: 3 }));
  assert.equal(result.categories.governance, 100);
  assert.equal(result.total, 10); // 10% weight, nothing else set
});

test('scoreEntity() sets operations to 100 only when level_1_count > 0', () => {
  const result = scoreEntity(signals({ level_1_count: 1 }));
  assert.equal(result.categories.operations, 100);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets technology to 100 only when has_cicd is true', () => {
  const result = scoreEntity(signals({ has_cicd: true }));
  assert.equal(result.categories.technology, 100);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets security to 100 only when has_security_ci_check is true, independent of has_cicd', () => {
  const result = scoreEntity(signals({ has_security_ci_check: true }));
  assert.equal(result.categories.security, 100);
  assert.equal(result.categories.technology, 0);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets resilience to 100 only when has_cushion_dimension is true, and finance stays 0', () => {
  const result = scoreEntity(signals({ has_cushion_dimension: true }));
  assert.equal(result.categories.resilience, 100);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.total, 10);
});

test('scoreEntity() sets knowledge to 100 only when verified_infrastructure_pass is true (5% weight)', () => {
  const result = scoreEntity(signals({ verified_infrastructure_pass: true }));
  assert.equal(result.categories.knowledge, 100);
  assert.equal(result.total, 5);
});

test('scoreEntity() marketing, sales, customer_experience, finance, learning are always 0 regardless of input', () => {
  const result = scoreEntity(signals({ level_1_count: 99, level_2_count: 99, has_cicd: true, has_cushion_dimension: true, has_security_ci_check: true, verified_infrastructure_pass: true }));
  assert.equal(result.categories.marketing, 0);
  assert.equal(result.categories.sales, 0);
  assert.equal(result.categories.customer_experience, 0);
  assert.equal(result.categories.finance, 0);
  assert.equal(result.categories.learning, 0);
});

test('scoreEntity() with every real signal true sums to the full 90% (all 100-weighted categories) since marketing/sales/CX/finance/learning stay 0', () => {
  const result = scoreEntity(signals({ level_1_count: 1, level_2_count: 1, has_cicd: true, has_cushion_dimension: true, has_security_ci_check: true, verified_infrastructure_pass: true }));
  // governance 10 + operations 10 + technology 10 + security 10 + resilience 10 + knowledge 5 = 55
  assert.equal(result.total, 55);
});

test('averageScore() computes the unweighted mean of a list of totals, rounded to 1 decimal', () => {
  assert.equal(averageScore([0, 10, 20]), 10);
  assert.equal(averageScore([0, 0, 10]), 3.3);
});

test('averageScore() of an empty list returns 0, not NaN or a thrown error', () => {
  assert.equal(averageScore([]), 0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd services/autonomy-score && node --test`
Expected: FAIL — `Cannot find module '../src/score.js'`

- [ ] **Step 4: Write `src/score.js`**

```javascript
const CATEGORY_WEIGHTS = {
  governance: 10,
  operations: 10,
  technology: 10,
  marketing: 10,
  sales: 10,
  customer_experience: 10,
  finance: 10,
  security: 10,
  resilience: 10,
  knowledge: 5,
  learning: 5,
};

export function scoreEntity(signals) {
  const categories = {
    governance: signals.level_2_count > 0 ? 100 : 0,
    operations: signals.level_1_count > 0 ? 100 : 0,
    technology: signals.has_cicd ? 100 : 0,
    marketing: 0,
    sales: 0,
    customer_experience: 0,
    finance: 0,
    security: signals.has_security_ci_check ? 100 : 0,
    resilience: signals.has_cushion_dimension ? 100 : 0,
    knowledge: signals.verified_infrastructure_pass ? 100 : 0,
    learning: 0,
  };

  let total = 0;
  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    total += (categories[category] / 100) * weight;
  }

  return { categories, total: Math.round(total * 10) / 10 };
}

export function averageScore(totals) {
  if (totals.length === 0) return 0;
  const sum = totals.reduce((acc, n) => acc + n, 0);
  return Math.round((sum / totals.length) * 10) / 10;
}

export { CATEGORY_WEIGHTS };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd services/autonomy-score && node --test`
Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add services/autonomy-score/package.json services/autonomy-score/src/score.js services/autonomy-score/test/score.test.js
git commit -m "feat: autonomy-score scoreEntity/averageScore (pure computation)

Binary per-category formulas per the design spec's one-signal-per-category
table. marketing/sales/customer_experience/finance/learning always score 0
today -- no fabricated continuous scale, no invented partial credit."
```

---

### Task 3: `services/autonomy-score/src/cli.js` + README + manual verification

**Files:**
- Create: `services/autonomy-score/src/cli.js`
- Create: `services/autonomy-score/README.md`
- Create: `services/autonomy-score/.gitignore`

**Interfaces:**
- Consumes: `scoreEntity`, `averageScore`, `CATEGORY_WEIGHTS` from `./score.js` (Task 2); reads `../../platforms/autonomy-signals.json` (Task 1) at runtime.

- [ ] **Step 1: `.gitignore`**

```
node_modules/
```

- [ ] **Step 2: Write `src/cli.js`**

```javascript
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { scoreEntity, averageScore } from './score.js';

const CATEGORY_LABELS = {
  governance: 'Governance',
  operations: 'Operations',
  technology: 'Technology',
  marketing: 'Marketing',
  sales: 'Sales',
  customer_experience: 'Customer Experience',
  finance: 'Finance',
  security: 'Security',
  resilience: 'Resilience',
  knowledge: 'Knowledge',
  learning: 'Learning',
};

const REASON_WHEN_ZERO = {
  governance: 'no real Level 2 (Escalate) process found in the audit',
  operations: 'no real Level 1 (Autonomous) process found in the audit',
  technology: 'no CI/CD workflow found in the audit',
  marketing: 'no real marketing automation exists anywhere in the ecosystem yet',
  sales: 'no real sales-pipeline automation exists anywhere in the ecosystem yet',
  customer_experience: 'no real automated support/onboarding beyond end-user self-service exists yet',
  finance: 'no real finance-operations automation exists on this entity (cushion evidence, where present, is counted under Resilience instead)',
  security: 'no dependency-review/security-specific CI check found in the audit',
  resilience: 'no real cushion dimension exists on this entity',
  knowledge: 'this entity has not been through the 2026-08-07 verified-infrastructure-pass reconciliation',
  learning: 'no real production learning loop exists yet -- the Owner Intervention Log has no real production entries',
};

function loadSignals() {
  const path = new URL('../../platforms/autonomy-signals.json', import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printEntityReport(signals) {
  const { categories, total } = scoreEntity(signals);
  console.log(`\n=== ${signals.entity} (${signals.kind}) ===`);
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    const value = categories[category];
    const reason = value === 0 ? ` -- ${REASON_WHEN_ZERO[category]}` : '';
    console.log(`  ${label}: ${value}${reason}`);
  }
  console.log(`  TOTAL: ${total}/100`);
  console.log(`  (signals as of ${signals.audited_date} -- re-audit to refresh)`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = {};
  for (const arg of rest) {
    const match = arg.match(/^--([a-z-]+)=(.*)$/s);
    if (match) flags[match[1].replace(/-/g, '_')] = match[2];
  }

  if (command !== 'report') {
    console.error('Usage: autonomy-score report [--entity=<id>]');
    process.exit(1);
  }

  const allSignals = loadSignals();

  if (flags.entity === 'dot') {
    const platformSignals = allSignals.filter((s) => s.kind === 'platform');
    const platformTotals = platformSignals.map((s) => scoreEntity(s).total);
    console.log(`\n=== Dot ecosystem: 29-platform average ===`);
    console.log(`  Average score: ${averageScore(platformTotals)}/100 (mean of ${platformTotals.length} individual platform scores below)`);
    for (const s of platformSignals) {
      console.log(`    ${s.entity}: ${scoreEntity(s).total}/100`);
    }
    const dotOwnEntity = allSignals.find((s) => s.entity === 'dot');
    if (dotOwnEntity) {
      console.log(`\n--- Dot.Brain's own entity score (separate from the platform average above) ---`);
      printEntityReport(dotOwnEntity);
    }
    return;
  }

  if (flags.entity) {
    const entitySignals = allSignals.find((s) => s.entity === flags.entity);
    if (!entitySignals) {
      console.error(`Unknown entity: ${flags.entity}`);
      process.exit(1);
    }
    printEntityReport(entitySignals);
    return;
  }

  for (const s of allSignals) {
    printEntityReport(s);
  }
  const platformTotals = allSignals.filter((s) => s.kind === 'platform').map((s) => scoreEntity(s).total);
  console.log(`\n=== Dot ecosystem: 29-platform average ===`);
  console.log(`  Average score: ${averageScore(platformTotals)}/100`);
}

main();
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Autonomy Score

Computes the Autonomy Score (`../../brain.autonomy.md` §3) per entity from
`../../platforms/autonomy-signals.json`'s real, code-audited signals.
Binary per-category formulas only -- see `../../docs/superpowers/specs/2026-08-08-autonomy-score-design.md`
for the full formula table and the one-signal-per-category rule that
prevents double-counting.

## Usage

```bash
node src/cli.js report                    # every entity, full breakdown
node src/cli.js report --entity=dot-finance   # one platform
node src/cli.js report --entity=dot       # 29-platform average + Dot.Brain's own score, shown separately
```

## What's implemented

Binary category scoring (100 or 0, never a fabricated continuous value)
for all 11 `brain.autonomy.md` §3 categories, per-platform and ecosystem-
average reporting, explicit reasons printed for every 0.

## What's NOT implemented

- No dashboard/UI -- CLI text output only.
- No re-auditing -- `autonomy-signals.json` is a snapshot of the
  2026-08-08 platform audits; scores go stale as the real ecosystem
  changes until a future sub-project re-audits and updates that file.
- No autonomy interval/gate computation (`brain.autonomy.md` §5) --
  that needs incident/security-failure tracking this service doesn't have.
```

- [ ] **Step 4: Manual end-to-end verification**

```bash
cd services/autonomy-score
node src/cli.js report --entity=dot-agents
node src/cli.js report --entity=dot
node src/cli.js report --entity=houz-of-sax
```

Expected: `dot-agents` prints Governance=100, Operations=100, Technology=100, Security=100, all others 0, TOTAL=40 (10+10+10+10 from those four categories, out of the weight table — verify by hand: governance 10 + operations 10 + technology 10 + security 10 = 40, matches `dot-agents`' real signals of `level_2_count=3, level_1_count=4, has_cicd=true, has_security_ci_check=true`, everything else false). `dot` prints the 29-platform average followed by Dot.Brain's own all-zero entity score. `houz-of-sax` prints all-zero across every category with the explicit reasons.

- [ ] **Step 5: Run full test suite**

Run: `cd services/autonomy-score && node --test`
Expected: PASS (10 tests, from Task 2 — Task 3 adds no new automated tests, matching this repository's established precedent of manual CLI verification)

- [ ] **Step 6: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add services/autonomy-score/src/cli.js services/autonomy-score/README.md services/autonomy-score/.gitignore
git commit -m "feat: autonomy-score CLI (report) + README + manual verification

Completes services/autonomy-score/. Verified end-to-end: dot-agents
(4 real categories populated, TOTAL=40), dot (29-platform average +
Dot.Brain's own separate score), houz-of-sax (explicit all-zero)."
```

---

### Task 4: Repository registration

**Files:**
- Modify: `README.md`
- Modify: `indexes/INDEX.md`
- Modify: `indexes/CROSSREF.md`

**Interfaces:**
- Consumes: nothing new — cross-links to Tasks 1–3's artifacts.

- [ ] **Step 1: `README.md`**

In the `services/` tree entry, add a third line:

```
└── services/                        # Dot.Brain's own runnable code, one directory per brain.*.md that hosts an implementation · Business Agent · Dot.Brain itself
    ├── market-research/             # Implements brain.market_intelligence.md · Business Agent · Dot.Brain itself
    ├── intervention-log/            # Implements brain.autonomy.md §8 · Business Agent · Dot.Brain itself
    └── autonomy-score/              # Implements brain.autonomy.md §3 scoring · Business Agent · Dot.Brain itself
```

Bump `version: 1.6.0` → `version: 1.7.0` in the front-matter, add a Change Log row:

```
| 1.7.0 | 2026-08-08 | Autonomy Score sub-project | Registered services/autonomy-score/ and platforms/autonomy-signals.json in the services/ tree entry. |
```

- [ ] **Step 2: `indexes/INDEX.md`**

Extend the Runnable Services row:

```
| Runnable Services | services/ — Dot.Brain's own reference implementations of a brain.*.md contract (currently: market-research, intervention-log, autonomy-score) |
```

Bump `version: 1.3.0` → `version: 1.4.0`, add Change Log row:

```
| 1.4.0 | 2026-08-08 | Autonomy Score sub-project | Added autonomy-score to Runnable Services row |
```

- [ ] **Step 3: `indexes/CROSSREF.md`**

Add a row to the per-document reference table, near the `brain.autonomy.md` row:

```
| [../services/autonomy-score/](../services/autonomy-score/) | Binary category-formula implementation of brain.autonomy.md §3's Autonomy Score | brain.autonomy.md §3 (formula), platforms/autonomy-signals.json (data) |
```

Bump `version: 1.0.36` → `version: 1.0.37`, add Change Log row:

```
| 1.0.37 | 2026-08-08 | Autonomy Score sub-project | services/autonomy-score/ published: row added to §2 |
```

- [ ] **Step 4: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add README.md indexes/INDEX.md indexes/CROSSREF.md
git commit -m "docs: register services/autonomy-score/ in repo index

Registered as part of this sub-project's own deliverable, matching the
Autonomy Foundation sub-project's precedent."
```

## Self-Review Notes

- **Spec coverage:** Task 1 covers the design spec's "Data layer" section in full (all 32 entities, explicit Houz of Sax/BluPin zero rows, `dot`'s separate-but-mirrored row). Tasks 2–3 cover "Scoring layer" in full (all 11 category formulas, the double-counting rule enforced in code by construction — each category reads exactly one signal field). Task 4 covers repository registration, matching the pattern the design spec's own precedent (Autonomy Foundation) established.
- **Placeholder scan:** none — every step has literal file content, including the full 32-row JSON data file.
- **Type consistency:** `scoreEntity`/`averageScore` signatures match between Task 2's definition, its own tests, and Task 3's `cli.js` usage — field names (`level_1_count`, `level_2_count`, `has_cicd`, `has_cushion_dimension`, `has_security_ci_check`, `verified_infrastructure_pass`) are identical across `autonomy-signals.json`, `score.js`, `score.test.js`, and `cli.js`.
- **Honesty check specific to this plan:** Task 2's test suite explicitly asserts that marketing/sales/customer_experience/finance/learning stay 0 even when every other signal is maximally true (the "kitchen sink" test) — this is the concrete guard against a future edit silently making one of those categories scorable without a corresponding real signal being defined first.

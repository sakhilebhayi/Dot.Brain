# Autonomy Foundation: `brain.autonomy.md` + Owner Intervention Log

## Context

The owner requested an ecosystem-wide "Owner Independence" program spanning Houz
of Sax Trust → BluPin → Dot → individual Dot platforms (full 22-section brief
on file in conversation history). That brief describes a program, not a single
project: trust governance, corporate administration, marketing/sales/support
automation, financial intelligence, security monitoring, a scoring system, a
dashboard, and a multi-year interval schedule are each independent subsystems.

This spec covers only the **first sub-project**: the foundation everything
else in the program depends on. Nothing downstream (a score, a dashboard, a
streak) can be computed honestly until two things exist — a written contract
for what "autonomous" means and is measured against, and a real mechanism for
recording when the owner had to step in.

**Reality check driving every decision below:** as of this writing, Houz of
Sax Trust has zero code or documentation anywhere in this ecosystem; BluPin is
six static marketing pages with no backend automation; the Dot ecosystem has
real platform features but no cross-platform intelligence layer beyond
`Dot.Brain`'s shared docs and the new `services/market-research/`. An honest
Autonomy Score computed today would show 0 on Sales, Customer Experience, and
most of Marketing — not a bug, the actual state. This spec is written so that
stays visible rather than getting smoothed over later.

## Goal

Ship two things:

1. `brain.autonomy.md` — the shared contract (classification rules, score
   formula, boundary rules, anti-fabrication rules) that every later
   autonomy sub-project references instead of re-deriving.
2. `services/intervention-log/` — a small runnable CLI that lets a Claude
   session or the owner record an intervention as it happens, and query the
   resulting history (list, streak).

## Architecture

Follows the established `Dot.Brain` pattern: a `brain.*.md` contract document
plus, where the contract implies runnable behavior, a sibling service under
`services/` that implements it. `brain.cushion.md` and
`brain.market_intelligence.md` (paired with `services/market-research/`) are
the precedents this follows.

`services/intervention-log/` is its own directory, independent of
`services/market-research/` — different responsibility, no shared code
between them beyond both being small `node:sqlite`-backed CLIs with the same
directory shape (`src/`, `test/`, `package.json`, `README.md`).

## `brain.autonomy.md` — contents

Front-matter matches the existing `brain.*.md` files (title, version, status,
owners, last-review).

### §1 Organisational boundaries

Houz of Sax Trust, BluPin, Dot, each individual Dot platform, customers, and
external partners are separate entities. This document and everything built
against it must never blur, across those boundaries: ownership, governance,
financial accounts, legal entity, data ownership, permissions, liability, or
regulatory responsibility. Any future capability that moves data or
authority across an entity boundary must name the boundary it crosses
explicitly in its own spec — this contract does not pre-authorize any
cross-entity access.

### §2 Three-level autonomy classification

Every process, on every platform and in every entity, is classified as
exactly one of:

- **Level 1 — Autonomous.** Executes without owner approval. (Routine
  marketing, content research, SEO, monitoring, reporting, lead
  qualification, onboarding, routine support, internal task management,
  documentation, diagnostics, safe automated remediation, routine
  analytics.)
- **Level 2 — Escalate.** The system analyses and prepares the action but
  requires authorised human approval before it executes. Every Level 2
  proposal must present, in order: Context → Evidence → Risk →
  Recommendation → Proposed Action. (Significant spending, pricing changes,
  partnerships, contract changes, high-value sales, sensitive customer
  communications, material resource allocation, significant hiring.)
- **Level 3 — Human Control.** The owner holds explicit, non-delegable
  authority. Nothing built under this program may execute these
  autonomously, regardless of how confident any future automation becomes.
  (Legal ownership, trust/fiduciary decisions, banking authority, major
  financial commitments, regulatory submissions, legal agreements, security
  credential ownership, destructive operations, permanent deletion,
  strategic direction, major corporate restructuring.)

A process's classification is a property of the process, recorded wherever
that process is implemented (e.g. a future sales-engine spec states which of
its steps are L1 vs L2). This document is the shared vocabulary, not a
registry — no central list is maintained here.

### §3 Autonomy Score

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

**Honesty rule, binding on every future consumer of this formula:** a
category with no real underlying signal scores **0** for that entity, full
stop. It is never excluded from the weighted average and never assigned a
default, neutral, or estimated value. A dashboard may (and should) visually
distinguish "0 — capability does not exist yet" from "0 — capability exists
and is failing," but both contribute 0 to the number. Excluding unmeasured
categories from the denominator would let a barely-started entity's score
overstate its real maturity — the exact failure this program exists to
prevent (see §7).

### §4 Per-entity scoring

A score is computed separately for Houz of Sax Trust, BluPin, Dot (the
ecosystem layer), and each individual Dot platform. There is no single
blended "ecosystem score" that a strong entity's number can average out a
weak one behind. An ecosystem-level view (a future dashboard) presents all
scores side by side, never collapsed to one figure.

### §5 Autonomy intervals and gates

Progression sequence (days): 1 → 3 → 7 → 14 → 30 → 60 → 90 → 120 → 180 → 270
→ 365 → Continuous. An entity advances to the next interval only after
passing the gate for its current one:

- **Green — advance:** Autonomy Score ≥ 90, no unresolved critical incident,
  no major security failure, no uncontrolled financial loss, no critical
  customer failure, owner interventions below threshold, required monitoring
  operational, recovery procedures tested.
- **Yellow — repeat:** Score 75–89, minor recurring failures, owner
  dependency still too high, or important automation gaps remain. Repeat the
  same interval.
- **Red — reduce:** Score < 75, a critical incident occurred, security
  controls failed, material financial exposure occurred, a customer-critical
  process failed, or owner intervention became routine. Drop to a shorter
  interval.

A failure is never hidden to preserve a gate result or advance the schedule.

### §6 Owner-Free Operating Streak

Once an entity has real interval history, it gets a streak: current
consecutive days without a **routine** owner intervention, and the longest
streak on record. A **strategic** intervention (the owner making a Level 3
decision, or reviewing/approving a Level 2 escalation the system correctly
routed to them) does **not** reset the streak — that's the system working as
designed. A **routine** intervention (the owner doing something a Level 1
process should have handled, or being pulled in because automation failed)
resets it to zero. This classification is recorded on each Owner
Intervention Log entry (§8) and is what makes the streak computable rather
than a judgment call made after the fact.

### §7 Never hide a weak entity behind a strong one

Restates §4 as a standing rule: ecosystem-wide reporting must always surface
every entity's individual score. A high Dot-platform average must never be
presented in a way that obscures a Houz of Sax or BluPin score of 0.

### §8 Owner Intervention Log — what it is for

The mechanism that makes owner dependency measurable at all. Every time the
owner has to act on something that was expected to run autonomously (or
approve something a well-functioning Level 2 process routed to them), an
entry gets recorded — by a Claude session doing the work, or by the owner
directly for interventions that happened outside any session. Schema and CLI
in §9; this section states the non-negotiable content requirements for a
valid entry:

- **entity** — which of Houz of Sax / BluPin / Dot / a specific platform
  name this intervention concerned.
- **category** — `routine` or `strategic` (drives §6).
- **problem, trigger, root_cause** — what happened and why, in enough
  detail that a later session can act on it without re-investigating.
- **why_automation_failed** — required even when the honest answer is "this
  was never automated" — that answer is itself the signal this program
  exists to surface.
- **recommended_permanent_solution** — the point of logging an intervention
  is to eventually stop needing it; every entry proposes how.

### §9 Anti-fabrication rules (binding on this entire program)

Restated from the owner's original brief, verbatim in intent: never fake
revenue, customers, or engagement; never manufacture testimonials; never
hide failures, manipulate metrics, or suppress incidents; never mark
incomplete work complete; never treat agent activity itself as business
success. The objective of every sub-project under this program is to
**discover** whether autonomy exists, not to **prove** that it does.

## `services/intervention-log/` — implementation

Mirrors `services/market-research/`'s shape and conventions (`node:sqlite`,
zero runtime dependencies, `node --test` for tests, `.gitignore`d `data/`).

### Schema (`intervention_log` table)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PRIMARY KEY | autoincrement |
| `entity` | TEXT NOT NULL | e.g. `"Houz of Sax"`, `"BluPin"`, `"Dot"`, `"Dot.Finance"` |
| `platform` | TEXT | nullable — set only when narrower than `entity` |
| `category` | TEXT NOT NULL | `"routine"` or `"strategic"` — validated |
| `occurred_at` | TEXT NOT NULL | ISO 8601, defaults to now if not supplied |
| `problem` | TEXT NOT NULL | |
| `trigger` | TEXT NOT NULL | what caused the need for intervention |
| `root_cause` | TEXT NOT NULL | |
| `why_automation_failed` | TEXT NOT NULL | |
| `recommended_permanent_solution` | TEXT NOT NULL | |
| `decision_required` | TEXT | nullable |
| `time_spent_minutes` | INTEGER | nullable |
| `logged_by` | TEXT NOT NULL | `"session"` or `"owner"` — validated |
| `logged_at` | TEXT NOT NULL | ISO 8601, set automatically at insert time |

### `src/log.js`

- `openLog(dbPath)` — creates the table if absent (mirrors `memory.js`'s
  `openMemory`).
- `record(log, entry)` — validates all `NOT NULL` fields are present and
  non-empty, validates `category` ∈ {routine, strategic} and `logged_by` ∈
  {session, owner}, throws with the offending field name on failure (same
  contract as `memory.js`'s `save`). Sets `logged_at` server-side.
- `listEntries(log, {entity, since})` — both filters optional, newest first.
- `computeStreak(log, {entity})` — `entity` optional (omitted = whole
  ecosystem). Returns `{ currentStreakDays, longestStreakDays }`:
  - `currentStreakDays` = days between the most recent `routine` entry's
    `occurred_at` and now (or, if there is no `routine` entry at all, days
    since the earliest entry of any kind — the streak can only be measured
    from when logging began; before that, no claim is made).
  - `longestStreakDays` = the largest gap between consecutive `routine`
    entries (or from the start of logging to the first `routine` entry, or
    to now if there has never been one) found anywhere in the entry's
    history — a routine intervention breaks a streak but the historical
    longest gap is preserved.

### `src/cli.js`

```
intervention-log log --entity=<name> [--platform=<name>] --category=<routine|strategic> \
  --problem="<text>" --trigger="<text>" --root-cause="<text>" \
  --why-automation-failed="<text>" --recommended-solution="<text>" \
  [--decision-required="<text>"] [--time-spent-minutes=<n>] --logged-by=<session|owner>

intervention-log list [--entity=<name>] [--since=<ISO date>]

intervention-log streak [--entity=<name>]
```

Missing required flags print a usage error and exit non-zero (matches
`market-research`'s CLI error handling).

### Testing

`test/log.test.js` — unit tests against a temp SQLite file (same pattern as
`test/memory.test.js`): valid insert round-trips every field; missing each
required field throws naming that field; invalid `category`/`logged_by`
values throw; `listEntries` filters by entity and by since-date; `streak`
returns `{currentStreakDays: null-ish/whole-history, longestStreakDays: 0}`
shape on an empty log (no fabricated streak from nothing); `streak` with
only `strategic` entries reports the streak as unbroken since logging began;
`streak` with a mix of `routine` and `strategic` entries only breaks on the
`routine` ones.

No CLI-level tests beyond what `market-research`'s test suite already
establishes as sufficient coverage for this pattern (unit tests on the
logic, one manual end-to-end CLI run for verification).

## Explicitly out of scope for this sub-project

- Computing or displaying a live Autonomy Score for any entity (needs real
  per-category signals this sub-project doesn't create).
- The Autonomy Dashboard UI (§19 of the original brief).
- Classifying any of the ecosystem's actual existing processes into Level
  1/2/3 (this contract defines the levels; applying them platform-by-platform
  is future work).
- Any Houz of Sax Trust governance, mission, or fiduciary content — this
  spec creates zero content about the Trust itself.
- The Ecosystem Operating Intelligence Layer (§5 of the original brief),
  the marketing/sales/customer engines (§7–9), and the financial
  intelligence layer (§10) — all separate future sub-projects.

# Platform Autonomy Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan defines ONE canonical task pattern (Task 1, fully worked) applied identically to the 28 remaining platforms in the table in "Task Roster" — each is its own task, dispatched with the same steps and the platform-specific values substituted from that table.

**Goal:** For each of the 29 registered Dot platforms, produce an honest audit — grounded in that platform's real, current code, not assumption — classifying its actual existing processes into Level 1 (Autonomous) / Level 2 (Escalate) / Level 3 (Human Control) per `brain.autonomy.md` §2, appended as a new section to that platform's existing `platforms/<id>.md` knowledge document in this repository.

**Architecture:** No new files. Each task appends one `## Autonomy Classification (brain.autonomy.md)` section to an existing `platforms/<platform-id>.md`, inserted immediately before that file's `## Change Log` section (every platform doc ends `...domain sections... → Change Log → Open Questions`; this is the stable insertion point). Each task also bumps that file's `version` front-matter field and adds one Change Log row — same discipline the 2026-08-07 "Verified Infrastructure State" pass used on these same files.

**Tech Stack:** Markdown only. No code changes to any platform repository — this plan is Dot.Brain-side documentation about platforms, never platform-owned files. Investigation reads each platform's real repository at `~/Dot/<RepoName>` (mapping in the Task Roster table) — routes, controllers, jobs/schedulers, notification/queue config, CI, auth/permission checks — to ground the classification in what the code actually does today.

## Global Constraints

- Classification vocabulary is fixed by `brain.autonomy.md` §2 — Level 1 (Autonomous), Level 2 (Escalate), Level 3 (Human Control) — verbatim, no new levels invented.
- **No fabrication.** A platform with zero real automation gets an honest "no Level 1 processes exist yet" — not an invented one to fill the section. This mirrors the existing honesty style already present in these files (e.g. `platforms/dot-finance.md` §3: "None. No domain events are dispatched in the current codebase... **Roadmap**, not shipped.").
- Every classified process must cite where in the real codebase it lives (file/route/job name) or state plainly that it doesn't exist yet if the audit finds a gap against what the platform *should* eventually have.
- This plan produces documentation only. No platform repository's own files (`wiki.md`, application code) are touched — Dot.Brain proposes/observes, platforms decide, per `README.md`'s ownership boundary.
- Each task's diff is exactly one file in the Dot.Brain repo: `platforms/<platform-id>.md`.
- Every task ends with a commit in the Dot.Brain repo. Never commit inside a platform's own repository.

---

### Task 1: `dot-finance` autonomy classification (canonical worked task)

**Files:**
- Modify: `platforms/dot-finance.md` (insert new section before `## Change Log`; bump `version` front-matter; add Change Log row)

**Interfaces:**
- Consumes: `brain.autonomy.md` §2 (Level 1/2/3 definitions) — read this file first for the exact wording to cite.
- Produces: nothing consumed by other tasks — every platform task is independent and can run in any order.

- [ ] **Step 1: Read the platform's real code**

Read the actual repository at `/Users/sakhilebhayi/Dot/Dot.Finance` — specifically `routes/`, `app/Console/Commands/` and `app/Console/Kernel.php` (scheduled jobs), `app/Jobs/`, `app/Notifications/`, `app/Http/Middleware/` (auth/permission checks), and any `app/Services/` classes — to find every real, currently-shipped process. Cross-check against `platforms/dot-finance.md`'s existing §1–§11 (already an honest inventory of what's real vs. roadmap as of 2026-08-01/08-07) rather than re-deriving from scratch — that file already states, for example, that no domain events are dispatched and no DKP is published. Do not classify anything the file or the code doesn't actually show exists.

- [ ] **Step 2: Classify each real process**

For every real process found, assign exactly one of Level 1 / Level 2 / Level 3 per `brain.autonomy.md` §2's definitions and examples. Most CRUD/reporting operations in a single-user finance tracker will be Level 1 (routine data entry, budget tracking, reporting) since the user is acting on their own data, not the platform acting on the owner's behalf — the distinction that matters for this audit is **platform-operator autonomy** (can Dot.Finance's own operations — deploys, data fixes, scheduled jobs, support responses — run without Sakhile Bhayi's routine involvement), not end-user self-service. Read `brain.autonomy.md` §2 closely: the classification is about who has to act, not who benefits.

- [ ] **Step 3: Write the section**

Insert this section into `platforms/dot-finance.md` immediately before the `## Change Log` heading (find that heading, insert above it):

```markdown
## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Finance` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous
[List each real process the platform-operator does not need to act on, with the file/route/job it lives in. If none exist, write: "None found. [Platform] has no real automation the operator can currently stay out of the loop for — every operational task listed below still needs a human." Do not invent one to avoid an empty list.]

### Level 2 — Escalate
[List each real process that prepares a decision but requires the operator's approval before acting, with where it lives. If none exist: "None found — no code path currently prepares a decision and routes it for approval; anything resembling this today is fully manual, not semi-automated."]

### Level 3 — Human Control
[List the real processes only the operator can do today — deploys, database fixes, account/billing decisions, security credential rotation, etc. — with brief justification. This section is rarely empty; if it somehow is, say so explicitly rather than omitting it.]

### Gap summary
[One or two sentences: what would need to be built for the platform's first real Level 1 process to exist, if none do today. This is the actionable output of the audit — not a new commitment, just an honest observation for a future sub-project to pick up.]
```

Fill in the bracketed content with what Step 1–2 actually found — every bracket must be replaced with real, specific content or an explicit "none found" statement per the templates above. No bracket may be left unfilled.

- [ ] **Step 4: Bump version and add Change Log row**

In `platforms/dot-finance.md`'s front-matter, bump `version` by one minor (e.g. `2.0.0` → `2.1.0` — read the file's current `version:` value first, this plan does not assume it). In that file's `## Change Log` table, add a row:

```
| <new-version> | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |
```

- [ ] **Step 5: Commit**

```bash
cd /Users/sakhilebhayi/Dot/Dot.Brain
git add platforms/dot-finance.md
git commit -m "docs: dot-finance autonomy classification (brain.autonomy.md §2)

Audited against the real Dot.Finance codebase. Part of the Platform
Autonomy Classification sub-project."
```

---

### Task Roster: remaining 28 platforms (identical steps, values below)

Every remaining task follows **exactly** Task 1's five steps, with only these three values substituted:

| Task | platform-id (file: `platforms/<id>.md`) | Real repo path |
|---|---|---|
| 2 | `dot-agents` | `/Users/sakhilebhayi/Dot/Dot.Agents` |
| 3 | `dot-analytics` | `/Users/sakhilebhayi/Dot/Dot.Analytics` |
| 4 | `dot-auction` | `/Users/sakhilebhayi/Dot/Dot.Auction` |
| 5 | `dot-billing` | `/Users/sakhilebhayi/Dot/Dot.Billing` |
| 6 | `dot-brain` | `/Users/sakhilebhayi/Dot/Dot.Brain` (this repository itself — audit Dot.Brain's own operations: document registration, the `services/` CLIs, ingestion) |
| 7 | `dot-central` | `/Users/sakhilebhayi/Dot/Dot.Central` |
| 8 | `dot-charts` | `/Users/sakhilebhayi/Dot/ChartSense` (real repo name differs from platform-id — this is correct, not a typo) |
| 9 | `dot-design` | `/Users/sakhilebhayi/Dot/Dot.Design` |
| 10 | `dot-docs` | `/Users/sakhilebhayi/Dot/Dot.docs` |
| 11 | `dot-dopemine` | `/Users/sakhilebhayi/Dot/Dot.Dopemine` |
| 12 | `dot-ehail` | `/Users/sakhilebhayi/Dot/Dot.Ehail` |
| 13 | `dot-emall` | `/Users/sakhilebhayi/Dot/Dot.Emall` |
| 14 | `dot-engage` | `/Users/sakhilebhayi/Dot/Dot.Engage` |
| 15 | `dot-farms` | `/Users/sakhilebhayi/Dot/Dot.Farms` |
| 16 | `dot-files` | `/Users/sakhilebhayi/Dot/Dot.Files` |
| 17 | `dot-forms` | `/Users/sakhilebhayi/Dot/Dot.Forms` |
| 18 | `dot-hr` | `/Users/sakhilebhayi/Dot/Dot.HR` |
| 19 | `dot-infodot` | `/Users/sakhilebhayi/Dot/InfoDot` |
| 20 | `dot-memory` | `/Users/sakhilebhayi/Dot/Dot.Memory` |
| 21 | `dot-mines` | `/Users/sakhilebhayi/Dot/mines` (real repo name differs from platform-id — this is correct, not a typo) |
| 22 | `dot-notify` | `/Users/sakhilebhayi/Dot/Dot.Notify` |
| 23 | `dot-plug` | `/Users/sakhilebhayi/Dot/Dot.Plug` |
| 24 | `dot-press` | `/Users/sakhilebhayi/Dot/Dot.Press` |
| 25 | `dot-projects` | `/Users/sakhilebhayi/Dot/Dot.Projects` |
| 26 | `dot-pulse` | `/Users/sakhilebhayi/Dot/Dot.Pulse` |
| 27 | `dot-sheet` | `/Users/sakhilebhayi/Dot/Dot.Sheet` |
| 28 | `dot-tasks` | `/Users/sakhilebhayi/Dot/Dot.Tasks` |
| 29 | `dot-tutor` | `/Users/sakhilebhayi/Dot/Dot.Tutor` |

For task N (2–29): read `platforms/<platform-id>.md` (from the table) instead of `platforms/dot-finance.md`; read the real repo at the table's "Real repo path" instead of `~/Dot/Dot.Finance`; use that platform's actual `version:` front-matter value as the bump base; commit message references that platform's id instead of `dot-finance`. Every other word of Task 1's five steps — the section template, the honesty rules, the commit body's second sentence — carries over unchanged. The dispatcher (controller session) writes each task's concrete brief by copying Task 1's steps verbatim with these three substitutions before dispatching — this is not the implementer's judgment call to make, it removes any ambiguity about what "identical" covers.

---

## Self-Review Notes

- **Spec coverage:** every registered platform (29 of 29 per `platforms/`) gets exactly one task; no platform skipped, no platform double-covered.
- **Placeholder scan:** Task 1 has zero unfilled placeholders — every bracket in the section template has an explicit instruction for what real content or honest "none found" statement replaces it. The Task Roster intentionally does not re-print Task 1's full step text 28 times (that would be ~4,000 duplicate lines); instead it names the exact three substitution values per task and states plainly that the dispatcher — not the implementer — performs the substitution before dispatch, so no implementer ever has to infer "similar to Task 1" unassisted.
- **Type consistency:** n/a (no code, no shared function signatures across tasks — each task's diff is one independent Markdown file).
- **Honesty check specific to this plan:** the section template's Level 1/2/3 blocks each have an explicit "if none found" fallback string, and Step 2 explicitly warns against classifying end-user self-service as platform-operator autonomy — the single most likely fabrication risk in this plan (inflating Level 1 counts by counting normal app usage as "autonomous operations").

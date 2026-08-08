---
title: Dot.Tasks — Platform Knowledge
version: 1.1.0
status: active
owners: [Tasks Platform Lead, Delivery Agent, Registry Agent]
platform-id: dot-tasks
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Tasks

> **Platform-owned source:** [Dot.Tasks's wiki.md](https://github.com/sakhilebhayi/Dot.Tasks/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

Recurring operational work: inspection rounds, maintenance routines, compliance checklists, and standing queues. Owns the delivery domain at the *routine* granularity — the counterpart to Dot.Projects under the shared boundary rule: **Projects owns work with end dates; Tasks owns work that recurs** (canonical statement in dot-projects §1; this doc defers to it). Tasks' knowledge value is high-frequency: thousands of small completions produce dense, fast-cycling evidence about how routine work actually behaves — the highest-volume outcome stream in the ecosystem after Notify's deliveries.

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Task template | `entity:asset` | template ID | May be project-spawned (provenance kept) |
| Queue | `entity:process` | org + queue | Health-attributed, never "finished" |
| Task instance (operational) | — | — | **Never graphed individually** — only template-level aggregates cross (the trip/bid exclusion pattern at volume) |
| Routine observation | `observation` | template × site-cohort × window | n ≥ 50 instances, ≥ 20 distinct assignee-roles |
| Routine outcome | `outcome` | template + period | Completion-quality ground truth (rework rate, not just done-rate) |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `routine.instance.completed/overdue` | Instance lifecycle | Brain (aggregate only), queue dashboards | ~10⁴/day |
| `routine.template.escalated` | Recurring failure exceeds routine capacity | Dot.Projects (escalation handoff), Brain | low |
| `routine.queue.health_shift` | Queue health regime change | Brain, org leads via Notify | low |

## 4. Knowledge Packs Published

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (template completion/rework aggregates) | weekly | `dkp:tasks:obs:2026-07-08:0019` |
| insight (routine-design findings) | per finding | `dkp:tasks:ins:2026-06-12:0001` |
| outcome (recommendation verifications) | per verified recommendation | `dkp:tasks:out:2026-07-24:0001` |
| incident (routine failures with ecosystem lessons) | per incident | `dkp:tasks:inc:2026-05-15:0001` |

Rework-honesty rule: completion aggregates always pair done-rate with rework-rate — a checklist marked complete and then redone is the routine-work version of engagement without outcomes, and publishing done-rates alone would be a proxy-metric violation.

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Routine-frequency tuning (the flagship — P-2026-001's home genre: moisture-indexed inspection scheduling *is* a task-frequency recommendation) | `routine.rework_rate` | per template family |
| Checklist-design suggestions (steps that predict rework when skipped) | `routine.rework_rate` | per template |
| Queue-load balancing (structure-level, role-based — never per-person assignment) | `routine.overdue_rate` | per queue |

## 6. Cross-Platform Relationships

```mermaid
flowchart LR
    P[Dot.Projects closure] -->|task-template spawn| T[Dot.Tasks]
    T -->|recurring failure escalation| P
    HR[Dot.HR role definitions] -->|assignee-role structures| T
    M[Dot.Mines / Dot.Farms] -->|domain routines execute here| T
    T -->|highest-volume outcome stream| B[Brain]
    DD[Dot.Dopemine] -->|decertified streak lesson origin| T
```

Tasks is where other platforms' operational recommendations *land as executable work*: Mines' moisture-indexed inspection scheduling executes as Tasks frequency changes; Farms' harvest checklists are Tasks templates. This makes Tasks the ecosystem's recommendation-execution substrate — and its completion data the natural verification source for other platforms' outcome packs (an outcome-evidence seam: the domain platform owns the outcome claim; Tasks owns the execution record it cites).

## 7. Tenancy Model

Tenant key = organization, sub-scoped by site and queue. Floors: n ≥ 50 instances and ≥ 20 distinct assignee-roles per template-cohort × window; assignees appear as HR roles only (work-not-workers, verbatim). Template *structures* are `open`-classified (a good inspection checklist is exactly the kind of knowledge the ecosystem should share freely); completion data is `ecosystem` with floors.

## 8. Dopamine Surface

The platform where the corpus's founding negative result happened: dopemine's 2026-05 self-decertification was a completion-streak mechanic *on Tasks* — completion inflation with quality flat. That lesson is structural here: **done-rate is never surfaced without rework-rate beside it** (the paired-metric layout rule from design §4, enforced in the platform UX, not just in packs). Withheld: individual completion streaks (the decertified mechanic), per-person throughput rankings, queue-clearing countdown pressure. Shared: queue health (legible, collective), team rework-trend improvement — quality-anchored, and the only granularity at which the certified milestone mechanic may deploy here.

## 9. Active Recommendations

Maintained by the Registry Agent. Current: routine-frequency tuning `verified` — see §13; checklist-design suggestion for pre-dispatch equipment checks `open` (expiry 2026-09-08).

## 10. Incident History Summary

Two entries: (2026-05, shared with dopemine) the completion-streak decertification — recorded here from the execution side: the inflation was visible in Tasks' own rework pairing before the mechanic review, which is why the pairing rule is now structural. (2026-05-15 pack) a template rollout skipping site-condition adaptation caused a rework spike — the uncondition-checked-citation failure in checklist form; lesson aligned template rollout with patterns §5 condition checks.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `routine.rework_rate` | ratio | Instances redone or failing quality check / instances completed, per template |
| `routine.overdue_rate` | ratio | Instances overdue at window close / instances due, per queue |
| `routine.escalation_rate` | ratio | Templates escalated to projects / active templates, quarterly — the boundary metric |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-tasks",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-tasks/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["routine-frequency-tuning", "checklist-design", "queue-load-balancing"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "default_classification": "ecosystem",
  "tenancy": {
    "key": "org_id",
    "aggregation_floor": 50,
    "publication_rules": [
      { "rule": "done-rate-rework-rate-pairing", "enforcement": "reject-at-ingestion" },
      { "rule": "no-individual-assignees", "enforcement": "reject-at-ingestion" }
    ]
  }
}
```

## 13. Worked round-trip

1. **Pack:** `dkp:tasks:obs:2026-07-08:0019` — completion/rework aggregates for haul-road inspection templates at Kolomela and Sishen after the moisture-indexed frequency change (the execution record behind Mines' verified outcome), n = 1,240 instances, 31 assignee-roles.
2. **Validation → graph:** the pack's execution data corroborates Mines' `dkp:mines:out:2026-06-28:0003` from the execution side (×1.10 on the CAUSES chain) — the outcome-evidence seam (§6) working: Mines claimed, Tasks' record confirms.
3. **PR back (routine-frequency tuning):** the same moisture-index logic applied to *conveyor* inspection templates — adjacent equipment family, condition checklist run per patterns §5: rainfall exposure ✓, surface-condition dependency ✓, sensor coverage ✓; confidence 0.78 provisional; impact `routine.rework_rate` −20% predicted, guard `routine.overdue_rate` flat, expiry 60 days.
4. **Outcome:** `dkp:tasks:out:2026-07-24:0001` — rework −23% verified, guard held; confidence re-scores to 0.83. Second graduation through the provisional band (after Auction §13), and the conveyor result is filed to the P-2026-001 condition-family review alongside Projects' wet-season calibration finding.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed; `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 23 files reformatted, formatting-only. `composer audit` / `npm audit`: already clean, no advisories found. Full suite reconfirmed green (24 tests / 24 passed / 45 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Tasks` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

- **`tasks:check-due-soon` scheduled command.** Runs unattended daily at 07:00 (`Schedule::command('tasks:check-due-soon')->dailyAt('07:00')`, `routes/console.php:12`). The command (`app/Console/Commands/CheckTasksDueSoon.php`) queries tasks due within two days, sends an in-app `database`-channel `TaskDueSoonNotification` to each assignee, and de-duplicates against the last 24h so re-runs don't spam. It executes with no owner approval, has a bounded/idempotent blast radius, and is low-risk routine monitoring/reporting — a textbook Level 1 example per §2 ("routine … monitoring … reporting"). This is the only scheduled process in the codebase (`app/Console/Commands/` contains exactly one command; no other `Schedule::` calls exist outside `routes/console.php`).

### Level 2 — Escalate

None found. Checked for: queued/background jobs (`app/Jobs/` does not exist as a directory; no class in the repo implements `Illuminate\Contracts\Queue\ShouldQueue`, confirmed via a repo-wide grep — `QUEUE_CONNECTION=database` in `.env.example` is configured but unused), any workflow that prepares an action and waits on operator sign-off before executing it, and any auto-remediation. The one AI-adjacent capability in the codebase, `app/Services/AiTaskBreakdownService.php` (calls the Anthropic Messages API to split a task into subtasks), is synchronous, user-invoked, and writes its result directly for the requesting end user with no operator-approval step in between — it is end-user self-service, not a platform-operator escalation, so it is out of scope for this classification rather than a Level 2 candidate.

### Level 3 — Human Control

- **Deployment / release process.** No CI/CD exists anywhere in the repo — `find .github -type f` and a repo-wide `*.yml`/`*.yaml` search (excluding `vendor/`, `node_modules/`) both return nothing. `composer.json`'s `scripts` block (`composer.json`) defines only local `setup`/`dev`/`test` scripts (`composer install`, `artisan key:generate`, `artisan migrate --force`, `npm run build`); there is no pipeline that builds, tests, or ships a release without a human running these commands by hand. Shipping code to this platform is entirely manual today.
- **Database migration / initial provisioning.** The `composer run setup` script runs `php artisan migrate --force` directly against the target database with no gate, approval step, or automated trigger — an operator must invoke it (`composer.json` `scripts.setup`).
- **`ANTHROPIC_API_KEY` credential ownership.** `config/services.php:38-40` reads the Anthropic API key and model straight from `.env` (`ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` in `.env.example:72-73`) for `AiTaskBreakdownService`. There is no rotation, vaulting, or automated provisioning in the codebase — provisioning and rotating this secret is a manual operator action, matching §2's "security credential ownership" example directly.
- **Ecosystem SSO token issuance.** `app/Http/Controllers/Auth/EcosystemAuthController.php` logs a user in by redeeming a Sanctum `PersonalAccessToken` scoped to the `ecosystem:read` ability (single-use — the token is deleted on redemption). The repo contains no code path that mints these tokens; creating and distributing an `ecosystem:read` token to another platform is a manual, operator-controlled security action outside this codebase.

### Gap summary

Dot.Tasks has exactly one real autonomous process today (`tasks:check-due-soon`), and it is narrow: a single daily reminder job with no downstream action beyond a notification. For the platform's *next* Level 1 process to exist, the highest-leverage build is queue-backed automation with a real trigger-condition → safe-action loop and no owner in the path — e.g. auto-escalating a routine that has failed repeatedly (the `routine.template.escalated` event already described in §3 of this document is defined at the knowledge-pack level but has no implementing code in `app/Console/Commands/` or `app/Jobs/` yet). Level 2 is emptier still: nothing in the codebase currently proposes an action and waits for Sakhile's approval before executing it; the nearest candidate would be gating `routine.template.escalated` behind an approval step before it fires into Dot.Projects, which does not exist today.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: routine-granularity ownership deferring to dot-projects boundary statement, execution-substrate role and outcome-evidence seam, done/rework pairing made structural (decertified-streak lesson), open-classified template structures, 3 domain metrics, worked round-trip corroborating the canonical Mines outcome |

| 1.0.1 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Tasks's own wiki.md (platform repo) as the platform-owned source of truth |

| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Outcome-evidence seam: should domain-platform outcome packs be *required* to cite Tasks execution records where routines executed the change? | Learning Agent → Chief AI Engineer |
| Open-classified template sharing: attribution expectations for orgs contributing checklist designs? | Delivery Agent → Chief Knowledge Engineer |
| **Known unfixed branding bug (flagged 2026-08-07, not fixed as part of the standardization pass):** the welcome page, logo components, app layout, dashboard, and a notification subject line all say "Dot.Sheet" instead of "Dot.Tasks," with no real Dot.Tasks logo asset anywhere in the repo — this platform appears to have been scaffolded from a Dot.Sheet copy and never rebranded. Too large to fix inline during the code-quality pass (needs a real logo asset sourced/generated plus a welcome-page rewrite and 5+ file rebrand); worked around for the legal/email/auth pass (text-only wordmark, no hero photo, no welcome-page footer edit) and spun off as its own follow-up task rather than silently left. | Platform Lead → Design Agent |

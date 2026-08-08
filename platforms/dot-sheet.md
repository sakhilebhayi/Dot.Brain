---
title: Dot.Sheet — Platform Knowledge
version: 1.1.0
status: active
owners: [Sheet Platform Lead, Registry Agent]
platform-id: dot-sheet
dkp-version: 1.0.0
integration-status: registered
last-review: 2026-08-02
---

# Dot.Sheet

> **Platform-owned source:** [Dot.Sheet's wiki.md](https://github.com/sakhilebhayi/Dot.Sheet/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

A genuine spreadsheet platform: a virtual-scrolled cell grid, a client+server formula engine, real-time multi-user collaboration via Reverb, comments, full version history, chart generation, CSV/XLSX import/export, and AI panels (formula generation, natural-language query, data cleaning, OCR, sentiment) backed by a swappable provider defaulting to Ollama, not a confirmed Claude integration as older docs implied.

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Spreadsheet | `entity:asset` | spreadsheet ID | Owner + optional team, sharable |
| Cell | `entity:asset` | spreadsheet × row × col | Formula + value |
| SharedUser | `entity:process` | spreadsheet × user | Tiered permission: view/comment/edit/admin |
| VersionHistory | `observation` | spreadsheet × version | Full history, restorable |
| ChartConfig | `entity:asset` | chart ID | Generated from sheet ranges |
| CellComment | `entity:asset` | comment ID | Cell-anchored, threaded |

## 3. Events Emitted

Real-time Reverb broadcast events for collaborative editing exist internally but are not yet DKP-mapped ecosystem events.

## 4. Knowledge Packs Published

None. No DKP manifest or publish pipeline exists.

## 5. Intelligence Consumed

None currently subscribed.

## 6. Cross-Platform Relationships

```mermaid
flowchart LR
    U[Team member / collaborator] -->|edits, tiered by permission| DS[Dot.Sheet]
    DS -->|CSV/XLSX| EXT[Import/export]
```

No cross-platform data exchange with other Dot Ecosystem platforms yet beyond shared ecosystem SSO and the shared `infodot` database.

## 7. Tenancy Model

Owner/team/tiered-share scoped via `SpreadsheetPolicy` (view / update / comment / manageSharing / delete, each checking owner, team-with-edit, or explicit share-tier). The integration pass found and closed the most severe finding across all 7 newly-integrated platforms: `SpreadsheetController` correctly authorized every action, but six Livewire sub-components (`ChartBuilder`, `CellCommentsPanel`, `SpreadsheetToolbar`, `AiFormulaModal`, `AiAnalysisPanel`, `VersionHistoryModal`) had zero authorization checks, and the main grid component only checked `view` at mount without re-checking `update` on mutating actions — meaning view-only and comment-only shared users could actually write cell data, comments, formatting, and charts. Fixed by adding `authorize('update', ...)` (or `authorize('comment', ...)` where appropriate, e.g. comment actions) matching the policy's existing tier logic.

## 8. Dopamine Surface

None identified as in-scope.

## 9. Active Recommendations

None — no Knowledge Pack publishing yet.

## 10. Incident History Summary

None recorded as a live incident, but the tenancy finding in §7 was a real, exploitable privilege-escalation gap (view/comment-tier users could write) — closed before any known exploitation, not after. Also found and fixed: a broken `/dashboard` route left in an inconsistent state by a prior commit (`routes/web.php` was updated but `dashboard.blade.php` still referenced the old variable names, which would throw an undefined-variable error on every visit).

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed via `composer require --dev --ignore-platform-req=php` (this platform shares `maatwebsite/excel`'s `phpoffice/phpspreadsheet` dependency with dot-forms, which requires `php <8.5.0` against this ecosystem's PHP 8.5.9); `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 42 files reformatted, formatting-only. `composer audit`: **26 advisories across 9 packages**, all patched — same combination and fix as dot-forms: `laravel/framework` (signed-URL/CRLF), `phpoffice/phpspreadsheet` → 1.30.6 (SSRF/RCE via `IOFactory::load`, XSS, memory-exhaustion DoS chain), `symfony/*` transitive, `league/commonmark` baseline. `npm audit`: patched `ws` uninitialized-memory-disclosure + memory-exhaustion DoS (via engine.io-client, 11 issues). Full suite reconfirmed green (45 passed / 7 skipped / 89 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Sheet` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

- **Transactional notification dispatch (no operator involvement, ever).** `App\Notifications\MentionedInComment` and `App\Notifications\WorkflowRuleTriggered` (`app/Notifications/MentionedInComment.php`, `app/Notifications/WorkflowRuleTriggered.php`) fire automatically — the mention notification from `app/Livewire/CellCommentsPanel.php` and `app/Livewire/ShowSpreadsheet.php`, the workflow-rule notification inline in `app/Livewire/ShowSpreadsheet.php:1417` — and are delivered via mail/database channels with zero human review or approval gate. Sakhile never sits in this loop today; it already runs unattended. Note: the *action* being reported (a mention, a rule match) is end-user-initiated, but the *dispatch decision itself* is a system process requiring no operator authorization, which is what makes it a genuine Level 1 finding rather than end-user self-service.
- **Runtime tenancy authorization enforcement.** `App\Policies\SpreadsheetPolicy` and `App\Policies\TeamPolicy` (`app/Policies/SpreadsheetPolicy.php`, `app/Policies/TeamPolicy.php`) evaluate on every request with no human in the loop — this is what closed the privilege-escalation gap recorded in §7/§10 above. It is safe automated remediation-by-design (deny-by-default access checks), not a decision that ever needs Sakhile's sign-off per-request.

### Level 2 — Escalate

None found. Checked: routes (`routes/web.php`, `routes/api.php`, `routes/console.php`), all three queued jobs (`app/Jobs/BulkPasteChunkJob.php`, `app/Jobs/ImportRowsChunkJob.php`, `app/Jobs/SimulateSpreadsheetEditJob.php`), both notifications, `app/Services/*` (`FormulaEvaluatorService.php`, `AiService.php`, `SpreadsheetImportExportService.php`), and both console commands. No process in this codebase prepares an action and then pauses for authorized human approval before executing (no Context→Evidence→Risk→Recommendation→Proposed Action gate exists anywhere) — every real automated process here either runs fully unattended (Level 1) or requires a human to manually invoke it in the first place (Level 3). The AI panels (`AiService.php`) are end-user-initiated, in-app, human-in-the-loop-by-the-end-user features, not operator-facing escalations, so they are out of scope for this operator-autonomy classification.

### Level 3 — Human Control

- **Database + storage backups, including destructive pruning.** `php artisan ops:backup` (`app/Console/Commands/RunBackupCommand.php`) is a real, working backup command — but it is registered nowhere: `routes/console.php` contains only the stock `inspire` command, and `bootstrap/app.php` declares no `withSchedule()` closure at all (confirmed by direct read; no `Schedule::` call exists anywhere in the codebase). It only runs when an operator types the command by hand. It also permanently deletes backup directories older than the retention window (`pruneOldBackups()`, same file) with no confirmation step — a destructive operation that today depends entirely on Sakhile (or whoever holds shell access) remembering to run it and choosing the retention window.
- **Load-test traffic generation against production/staging data.** `php artisan spreadsheet:load-test` (`app/Console/Commands/SpreadsheetLoadTestCommand.php`), which dispatches a `Bus::batch` of `App\Jobs\SimulateSpreadsheetEditJob` (`app/Jobs/SimulateSpreadsheetEditJob.php`) — an operator must supply a real spreadsheet ID and manually invoke the command; nothing schedules or gates it.
- **CI/CD pipeline: none exists.** No `.github/workflows/`, no other CI config file (`*.yml`/`*.yaml`) anywhere in the repo root or subdirectories, and `deploy/` contains only two `*.conf.example` Supervisor templates (`deploy/supervisor/queue-worker.conf.example`, `deploy/supervisor/horizon.conf.example`) — illustrative process-manager config, not a working pipeline. Every build, test, and deploy step for this platform is currently a fully manual operator action.

### Gap summary

Two real Level 1 processes exist today (notification dispatch, policy-based tenancy enforcement), but both are incidental side-effects of application code rather than a deliberately built owner-independence capability — there is no Level 2 escalation queue at all. The first genuine owner-independence milestone would be turning `ops:backup` into a real `Schedule::command()` entry with alerting on failure (removing the "operator must remember to SSH in and type a command" dependency), which would also be this platform's first process to move from Level 3 into a monitored Level 1/2 pairing (automatic backup = Level 1, automatic prune-to-delete = Level 2 escalation requiring approval before destructive deletion runs).

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-02 | Repository Steward Agent | Initial registration. Platform audited: SSO contract verified, DB_DATABASE misconfiguration fixed, a broken /dashboard route repaired, a systemic missing-authorization gap across six Livewire components closed (the most severe finding of the 7-platform integration pass), favicon wired into the authenticated layout, README corrected. |
| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| A lower-severity subset remains: settings-only mutations (hide/resize rows, validation rules) still inherit only `view` authorization rather than a dedicated check — flagged, not fixed this pass. | Sheet Platform Lead → Security Agent |

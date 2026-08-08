---
title: Dot.Central — Platform Knowledge
version: 1.1.0
status: active
owners: [Operations Intelligence Lead, Mining Agent, Registry Agent]
platform-id: dot-central
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Central

> **Platform-owned source:** [Dot.Central's wiki.md](https://github.com/sakhilebhayi/Dot.Central/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

Operational Intelligence Center — real-time dispatch, fleet monitoring, and control-room decision support for heavy operations (today: mining sites running Dot.Mines). Central owns the *decision moment*: it consumes operational events, surfaces the control-room picture, and executes dispatch decisions whose outcomes flow back as knowledge. It shares the Mining domain agent with Dot.Mines: Mines owns the operational *record*; Central owns the operational *decision*.

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Control room | `entity:site` | `dot:node:mining:controlroom:<id>` | Tenant root, maps 1:n to Mines sites |
| Dispatch decision | `entity:process` | room + timestamp + seq | The unit of record — see workflow node IDs below |
| Dispatch workflow | `entity:process` | `dot:node:mining:dispatch:<site>:<workflow>` | **Registry open-gap closure:** canonical ID scheme `dot:node:mining:dispatch:<site>:<assign\|reroute\|hold\|stagger>` — four workflow types, one node each per site, decisions link to them via `PART_OF` |
| Alert | `observation` | room + timestamp | Threshold and sentinel trips |
| Operator session | `entity:process` | operator + shift | Control-room staffing context (no individual performance surface — §8) |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `mining.dispatch.decided` | Decision executed | Brain ingestion, Dot.Mines | ~10³/day |
| `mining.dispatch.outcome` | Cycle(s) affected by a decision close | Brain (verification path) | ~10³/day |
| `mining.alert.raised/cleared` | Threshold/sentinel trip | Brain, control room | bursty |
| `mining.controlroom.shift_summary` | Shift end | Brain, Dot.Analytics | 2–3/room/day |

## 4. Knowledge Packs Published

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (decision + outcome telemetry) | hourly batch | `dkp:central:obs:2026-07-22:0088` |
| insight (dispatch-pattern findings) | per finding | `dkp:central:ins:2026-05-09:0003` |
| outcome (dispatch-recommendation verification) | per verified recommendation | `dkp:central:out:2026-07-30:0002` |
| incident (misroutes, alert storms) | per incident | `dkp:central:inc:2026-02-04:0002` — the F-PROC misroute, from the receiving side |

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Dispatch load-balancing | `mining.cycle_time_p50` (defined in [dot-mines.md](dot-mines.md) §11) | per site/shift |
| Alert-threshold tuning | `central.alert_precision` | 2026 H1 |
| Staffing/shift-pattern advisories | `central.decision_latency_p95` | per room |

## 6. Cross-Platform Relationships & the Loop-Latency Contract

```mermaid
flowchart LR
    M[Dot.Mines events] -->|operational stream| C[Dot.Central control room]
    C -->|dispatch decisions| M
    C -->|decision + outcome packs| B[(Dot.Brain)]
    B -->|dispatch recommendations, PR path| C
    C -->|shift reporting| A[Dot.Analytics]
```

**Loop-latency contract (canonical statement — settles the dot-mines open question; dot-mines defers here):**

- **Operational lane** (Mines events → Central decision): p95 ≤ 30 s, direct platform-to-platform — this lane never routes through the Brain; the Brain is not in the real-time path, by design.
- **Knowledge lane** (Central packs → Brain, Brain PRs → Central): standard contracts apply (`dkp.ingest_latency_p95` ≤ 15 min; recommendations via W5, decided in days). The two lanes never blur: a Brain recommendation cannot steer an in-flight dispatch, and real-time telemetry becomes knowledge only via signed packs through the front door.

## 7. Tenancy Model

Tenant key = control-room ID, sub-scoped to Mines site IDs; topics `mining.<room>.<event>`. Central inherits the contractor sub-tenant tagging of the Mines data it processes; cross-room aggregation observes the n ≥ 20 floor.

## 8. Dopamine Surface

Shares: alert-response completeness at room level (outcome-anchored). Explicitly withheld: individual operator decision-speed or override metrics — mirroring dot-mines' leaderboard refusal; rewarding fast dispatch decisions buys haste with safety, and operator overrides of automation are Loop B teaching signal, never a performance demerit ([brain.operating_model.md](../brain.operating_model.md) §5's blameless symmetry).

## 9. Active Recommendations

Maintained by the Registry Agent. Current: dispatch load-balancing `open` (expiry 2026-08-20); alert-threshold tuning `verified` (alert precision 0.61 → 0.78).

## 10. Incident History Summary

One incident pack (2026): dispatch misroute F-PROC (shared with dot-mines — Central's decision, Mines' consequence; single failure-catalog entry, two platform perspectives, blameless on both). Lesson: reroute workflows require a haul-cycle state check — now a validation rule on `dot:node:mining:dispatch:*:reroute` decisions.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `central.decision_latency_p95` | duration | Event arrival to dispatch decision executed, p95 per room |
| `central.alert_precision` | ratio | Alerts leading to an action or explicit stand-down / total alerts |
| `central.dispatch_override_rate` | ratio | Operator overrides of recommended dispatch — Loop B input, reviewed not targeted |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-central",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-central/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["dispatch-balancing", "alert-threshold-tuning", "staffing-advisory"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "tenancy": { "key": "controlroom_id", "aggregation_floor": 20, "subtenant": "site_id" }
}
```

## 13. Worked round-trip

1. **Pack:** `dkp:central:obs:2026-07-22:0088` — 940 dispatch decisions + outcomes, Kolomela room, one week; `mining.dispatch.decided`/`outcome` pairs joined; signed, `ecosystem`.
2. **Validation → graph:** decision nodes linked `PART_OF` → `dot:node:mining:dispatch:kolomela:reroute` (the workflow-node scheme in action); `OBSERVED_WITH` edge between post-rain reroute clustering and cycle-time variance at 0.68.
3. **PR back:** dispatch load-balancing recommendation — stagger reroutes across benches during moisture-flagged shifts (evidence chain cites the P-2026-001 pattern's moisture ancestry, conditions checked); confidence 0.81, impact `mining.cycle_time_p50` −8% predicted, guard `central.alert_precision` flat, expiry 21 days.
4. **Outcome:** control room accepts; `dkp:central:out:*` verification due next month — the loop's knowledge lane closing at knowledge speed while the operational lane keeps 30-second time.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed; `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 26 files reformatted, formatting-only. `composer audit`: patched 6 `league/commonmark` DoS advisories. `npm audit`: patched postcss path-traversal + shell-quote ReDoS (via concurrently). Full suite reconfirmed green (55 tests / 48 passed / 98 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Central` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

None found. Checked `routes/console.php` (contains only Laravel's default `inspire` Artisan command — no scheduled tasks registered), `bootstrap/app.php` (no `->withSchedule()` closure, so no cron-driven work exists at all), and searched the whole `app/` tree for a `Jobs` directory (none exists — no queued/background jobs). Every state-changing endpoint (`ControlRoomController`, `DispatchDecisionController`, `AlertController`, `OperatorSessionController`) executes synchronously inside an authenticated human HTTP request; nothing in the repo runs without a human initiating that request.

### Level 2 — Escalate

None found. No code path assembles a Context → Evidence → Risk → Recommendation → Proposed Action proposal and waits for operator approval before executing. The one candidate, `AgentChatService::chat()` (`app/Services/AgentChatService.php`), calls the Anthropic API synchronously in response to a human-submitted chat message and returns the reply directly in the same request/response cycle — it is a human-triggered conversation, not a system-initiated proposal awaiting sign-off.

### Level 3 — Human Control

- **Control-room lifecycle (tenant root)** — `app/Http/Controllers/ControlRoomController.php`: create/edit/update/delete all require an authenticated team member (`authorizeAccess()` calls `belongsToTeam`/`ownsTeam`); no autonomous path creates or removes a control room.
- **Dispatch decision recording** — `app/Http/Controllers/DispatchDecisionController.php`: decisions are only ever inserted by a human via `store()`, stamped with `decided_by_user_id` from the authenticated request; deletion is likewise manual (append-only log with human-only writes).
- **Alert lifecycle** — `app/Http/Controllers/AlertController.php`: raising, clearing (`update()` sets `cleared_at`), and deleting alerts are all human web actions; the resulting `AlertRaisedNotification` (`app/Notifications/AlertRaisedNotification.php`) is an in-app database notice to teammates, not an autonomous remediation.
- **Operator session (shift) management** — `app/Http/Controllers/OperatorSessionController.php`: starting, ending, and deleting shift sessions are manual, human-only writes.
- **Ecosystem SSO login** — `app/Http/Controllers/Auth/EcosystemAuthController.php`: consumes a single-use Sanctum personal access token scoped to `ecosystem:read`, deletes it, and logs the user in — security-credential handling, Level 3 by definition regardless of how routine it looks.
- **Team, user, and credential management** — `app/Actions/Jetstream/*.php` (`CreateTeam`, `DeleteTeam`, `AddTeamMember`, `RemoveTeamMember`, `InviteTeamMember`, `UpdateTeamName`, `DeleteUser`) and `app/Actions/Fortify/*.php` (`CreateNewUser`, `ResetUserPassword`, `UpdateUserPassword`, `UpdateUserProfileInformation`), gated by `app/Policies/TeamPolicy.php`'s `ownsTeam` checks — account and credential ownership, non-delegable per §2.
- **Deployment/CI-CD** — no `.github/workflows/`, no deploy scripts, and no scheduler exist anywhere in the repo (confirmed by direct search); whatever deployment process exists today happens entirely outside this codebase and is therefore fully manual by default, not automated-and-unclassified.

### Gap summary

Dot.Central currently has zero code paths that run without a human first opening a browser tab and submitting a form — there is no scheduler entry, no queued job, and no CI/CD pipeline in the repository. The platform's first real Level 1 process would need an actual trigger with no human in the loop: for example, a scheduled Artisan command (registered in `bootstrap/app.php`'s `withSchedule()`) that recomputes alert thresholds or exports a knowledge pack on a timer, running end-to-end without requiring Sakhile Bhayi to initiate or approve it.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: decision-moment ownership, dispatch-workflow node ID scheme (registry gap closed), canonical two-lane loop-latency contract, tenancy, withheld operator-speed surface, 3 domain metrics, manifest, worked round-trip |

| 1.0.1 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Central's own wiki.md (platform repo) as the platform-owned source of truth |

| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Operational-lane 30 s p95 is asserted from current control-room practice — needs measurement once `central.decision_latency_p95` has a quarter of data | Mining Agent → SRE Lead |
| Should `central.dispatch_override_rate` feed the colony's Loop B directly (structured override reasons), reusing brain.learning.md's taxonomy question? | Learning Agent → Chief AI Engineer |
| **Domain mismatch (flagged 2026-08-01):** Dot.Central's actual repository implements an AI-agent command center (conversations, agent skills, usage logs) — not the mining-dispatch/control-room platform this document describes. Either this document is describing a future rebuild, or the registry entry is wrong. Needs human reconciliation before this doc's contents are treated as authoritative. See [Dot.Central's wiki.md](https://github.com/sakhilebhayi/Dot.Central/blob/main/wiki.md) for what's actually built. | Registry Agent → Chief Knowledge Engineer |

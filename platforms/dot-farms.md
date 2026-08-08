---
title: Dot.Farms — Platform Knowledge
version: 1.1.0
status: active
owners: [Agriculture Platform Lead, Agriculture Agent, Registry Agent]
platform-id: dot-farms
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Farms

> **Platform-owned source:** [Dot.Farms's wiki.md](https://github.com/sakhilebhayi/Dot.Farms/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

Agriculture ERP for farming operations — crop planning, planting/harvest execution, irrigation and moisture management, input logistics, and yield tracking — serving farm owners, agronomists, and field operators. Owns the agriculture domain end-to-end from paddock to gate; downstream commerce (produce listing, settlement) belongs to Dot.Emall and Dot.Billing via the value chain in §6.

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Farm | `entity:site` | `dot:node:agriculture:farm:<id>` | Tenant root |
| Field/paddock | `entity:asset` | farm + field code | Carries soil-type and moisture-zone attributes |
| Crop cycle | `entity:process` | field + season + crop | Planting → harvest lifecycle |
| Planting/harvest log | `observation` | cycle + timestamp | The dopemine §6 conditional-pass case's subject |
| Moisture reading | `observation` | sensor + timestamp | Daily resolution; feeds the wet-season pattern's condition C |
| Yield record | `outcome` | cycle | Ground truth for seasonal verification |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `agriculture.cycle.started/completed` | Crop cycle state change | Brain ingestion, Dot.Analytics | ~10²/day ecosystem-wide |
| `agriculture.moisture.threshold` | Reading crosses configured band | Brain ingestion, irrigation advisories | bursty, seasonal |
| `agriculture.harvest.recorded` | Yield record committed | Brain, Dot.Emall (listing trigger) | seasonal peaks |
| `agriculture.incident.reported` | Crop loss/equipment failure | Brain (incident pack path) | low |

## 4. Knowledge Packs Published

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (moisture/operations) | daily batch | `dkp:farms:obs:2026-07-14:0032` |
| insight (agronomic correlations) | per finding | `dkp:farms:ins:2026-06-02:0004` |
| outcome (seasonal yield verification) | per harvest | `dkp:farms:out:2026-05-30:0011` |
| incident (crop-loss lessons) | per incident | `dkp:farms:inc:2026-01-19:0002` |

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Irrigation/moisture scheduling | `agriculture.water_use_per_ton` (registered here, §11) | 2026 season avg |
| Planting-window optimization | `agriculture.yield_per_hectare_p50` | per crop, per region |
| Logistics pre-positioning (wet-season pattern P-2026-001, conditions checked) | `agriculture.harvest_logistics_delay_p50` | 2026 wet season |
| Value-chain listing timing (via Dot.Emall) | `agriculture.produce_time_to_market_p50` | 2026 season |

## 6. Cross-Platform Relationships

```mermaid
flowchart LR
    F[Dot.Farms] -->|produce ready| E[Dot.Emall listing]
    E --> B[Dot.Billing settlement]
    B --> A[Dot.Analytics reporting]
    F <-->|shared vehicle-routing ontology| M[Dot.Mines haulage]
    F -->|engagement signals, constrained| D[Dot.Dopemine]
    P[Dot.Pulse grower community] -->|distilled packs only| F
```

The Farms→Emall→Billing→Analytics chain is the canonical value chain ([brain.business.md](../brain.business.md) §4); each link is a separate per-platform recommendation — no link commits the next.

## 7. Tenancy Model

Tenant key = farm ID; event topics `agriculture.<tenant>.<event>`; cross-tenant aggregation only above the n ≥ 20 distinct-contributor floor ([brain.community.md](../brain.community.md) §3 rules apply to grower-sourced content). Reasoning may generalize across tenants only from published packs, never raw tenant rows.

## 8. Dopamine Surface

Shares: planting-log completeness, seasonal-goal progress (outcome-anchored classes only). The streak mechanic runs under the dopemine §6 conditional pass — quality guard and dispersion sentinels attached, prohibited list applies in full. No notification-CTR or session-length signals shared.

## 9. Active Recommendations

Maintained by the Registry Agent. Current: wet-season logistics recommendation `verified` (closed); dry-climate E2 probe pending ([brain.patterns.md](../brain.patterns.md) §5).

## 10. Incident History Summary

One incident pack (frost-window forecast miss, 2026-01) — lesson contributed to seasonal-assumption checking; consumed lesson F-KNOW-2026-001's ancestry-check practice via propagation.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `agriculture.yield_per_hectare_p50` | gauge | Median yield per hectare, per crop cycle |
| `agriculture.water_use_per_ton` | ratio | Irrigation volume per ton yielded |
| `agriculture.harvest_logistics_delay_p50` | duration | Harvest-ready to transport-dispatched median |
| `agriculture.produce_time_to_market_p50` | duration | Gate to live Emall listing median |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-farms",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-farms/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["irrigation-scheduling", "planting-window", "logistics-prepositioning", "listing-timing"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "tenancy": { "key": "farm_id", "aggregation_floor": 20 }
}
```

## 13. Worked round-trip

1. **Pack:** `dkp:farms:obs:2026-11-03:0117` — moisture observations, 14 fields, Vaalharts farm cluster, wet-season onset; signed, classification `ecosystem`, sample_size 14 sensors.
2. **Validation:** schema pass; metric IDs resolve (§11); classification and tenancy fields present — ingested in 4 min (`dkp.ingest_latency_p95` contract).
3. **Graph:** 14 `observation` nodes; `OBSERVED_WITH` edges to harvest-logistics-delay nodes at 0.66 (two seasons' corroboration ×1.10).
4. **PR back:** logistics pre-positioning recommendation citing P-2026-001 *with condition checklist recorded* (lateritic access roads: yes; rainfall band: yes; daily moisture telemetry: yes) — confidence 0.84, impact `agriculture.harvest_logistics_delay_p50` −30% predicted, guard `agriculture.water_use_per_ton` flat, expiry 21 days. Farm team accepts; verification lands next harvest as an outcome pack.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed; `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 18 files reformatted, formatting-only. `composer audit`: patched 12 advisories across 2 packages — `guzzlehttp/guzzle` → 7.15.1 (host-only cookie scope, noncanonical cookie/host bypass, proxy-auth header leak to origin, URI-fragment Referer disclosure, unbounded response-cookies DoS) and `league/commonmark` baseline set. `npm audit`: already clean. Full suite reconfirmed green (62 tests / 55 passed / 107 assertions) after every change. (A stray, unrelated `.claude/worktrees/` directory — leftover Claude Code tooling artifact, not part of this platform — was correctly left out of every commit in this pass.)

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Farms` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

None found. Checked every place a Level 1 process would live: `routes/console.php` contains only Laravel's stock `inspire` command (no custom Artisan commands, no `Schedule::` calls anywhere in the repo — there is no `app/Console/Commands` directory and no scheduling registration in `bootstrap/app.php`); `app/Jobs` does not exist as a directory, so there are no queued jobs; `config/queue.php` sets `QUEUE_CONNECTION=database` but nothing dispatches to it in application code — the only place a queue worker runs is the local dev script (`composer.json` → `scripts.dev`, `php artisan queue:listen`); and `app/Notifications` contains exactly one class, `HarvestRecordedNotification` (`app/Notifications/HarvestRecordedNotification.php`), whose own docblock states it is "Not yet wired to any automatic trigger — dispatch manually ... until the `agriculture.harvest.recorded` event ... is actually published anywhere." No process in this codebase currently runs without a human-initiated request or a manual dispatch call.

### Level 2 — Escalate

None found. There is no code path that stages a proposed action and waits for operator approval before executing it — no draft/approve queue, no pending-review state machine, nothing resembling the Context → Evidence → Risk → Recommendation → Proposed Action shape brain.autonomy.md §2 requires for Level 2. The request-time actions that do exist (`app/Http/Controllers/Farms/*Controller.php` — farm/field/crop-cycle/planting/harvest CRUD wired in `routes/web.php`) execute immediately inside an authenticated end-user's own request; they are end-user self-service, not an operator-facing escalation, and are excluded from this classification per the task's operator-autonomy framing.

### Level 3 — Human Control

- **Deployment / CI-CD** — no `.github/workflows` directory exists in the repo at all (confirmed: `find .github` returns nothing). Nothing automatically builds, tests, or deploys this platform on push or on a schedule; whoever ships a change runs it by hand.
- **Provisioning and migrations** — `composer.json` → `scripts.setup` runs `composer install`, `artisan key:generate`, `artisan migrate --force`, and the npm build as a manual, human-invoked sequence. There is no automated migration-on-deploy step anywhere in the repo.
- **Dependency / security patching** — no `dependabot.yml` or `renovate.json` exists (checked repo root and `.github`). The dot-farms.md "Verified Infrastructure State (2026-08-07)" entry above documents that the most recent round of security patching (`composer audit` fixes to `guzzlehttp/guzzle` and `league/commonmark`, 18 files reformatted by Pint) was a manually-run, human-driven pass — not a bot or scheduled job.
- **Secrets / environment management** — `.env` / `.env.example` are the only configuration source; there is no vault or secrets-manager integration in application code (the `vault://keys/...` reference in §12's manifest example is illustrative DKP-schema documentation, not code that runs in this repo). Rotating or provisioning secrets is entirely manual.
- **Team/tenant authorization boundaries** — `app/Policies/FarmPolicy.php` and `app/Policies/TeamPolicy.php` encode the tenant boundary (`user->belongsToTeam($farm->team)`), but the policies themselves are only ever changed by a human editing code; there is no self-modifying or auto-tuning authorization logic to consider for a lower tier.

### Gap summary

Dot.Farms has no queued job, scheduled command, or automatically-triggered notification anywhere in its codebase today — the platform's first real Level 1 candidate is sitting unbuilt in plain sight: wiring `HarvestRecordedNotification` to actually fire when a `HarvestRecord` is created (an Eloquent observer or model event), which is exactly the "publish `agriculture.harvest.recorded`" gap the notification's own docblock and the wiki.md §5 event table already flag.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: entities, events, packs, consumed intelligence, value chain, tenancy, dopamine surface, 4 domain metrics registered, manifest, worked round-trip |
| 1.0.1 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Farms's own wiki.md (platform repo) as the platform-owned source of truth |
| 1.1.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Seasonal scope fields (registry open gap): add `season` as a first-class pack field or keep in payload context? | Agriculture Agent → Chief Knowledge Engineer |
| Grower-community packs arrive via Dot.Pulse — does Farms need its own distillation view or is Pulse's sufficient? | Community Agent → Chief Knowledge Engineer |

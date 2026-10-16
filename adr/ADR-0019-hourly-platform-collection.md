---
title: ADR-0019 — Hourly Platform Collection from Dot.Brain's GitHub Actions
version: 1.0.2
status: active
owners: [Chief Architect]
last-review: 2026-10-16
---

# ADR-0019 — Hourly Platform Collection from Dot.Brain's GitHub Actions

Purpose: record the decision to give Dot.Brain a recurring, queryable record of each live platform's state — one observation per platform per hour in Dot.Memory — and the decisions about where it runs and what it reuses.

> **Related documents:** [docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md](../docs/superpowers/specs/2026-10-16-hourly-platform-collection-design.md) — the full design · [ADR-0014-dot-guardian-architecture.md](ADR-0014-dot-guardian-architecture.md) — the contract and trust model this reuses · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — where the observations are recorded · [ADR-0016-health-failure-classification.md](ADR-0016-health-failure-classification.md) — the failure vocabulary · [../brain.architecture.md](../brain.architecture.md) · [../services/platform-collector](../services/platform-collector/README.md) — reference implementation.

---

## Status

Accepted — 2026-10-16

## Context

Dot.Brain should always know the current state of the live platforms. Today it has almost no recurring feed: Guardian (ADR-0014) polls every 5 minutes but exists to detect and remediate incidents: its working state lives in `actions/cache`, it archives only incidents — not a periodic state series — to Dot.Memory, and it has one platform enrolled, Dot.Mines; Revenue Reader (ADR-0018) has none; the DKP publish/subscribe gateway is not a running service. The deployed apps share one cPanel crontab, which three simultaneous deploys wiped on 2026-10-16 (F-INFRA-2026-001); Dot.Brain is not hosted there. GitHub's scheduler is also not a precise clock: Guardian's requested 5-minute cadence was measured at a median of about 2.5 hours (2026-08-27) and is now driven by an external dispatcher (`services/guardian-trigger`, a Cloudflare Worker that calls `workflow_dispatch`); this job's hourly cron is unmeasured, and the one comparable Brain cron that could be read, the since-retired `blupin-context.yml`'s weekday 03:05 UTC, started 18 to 32 minutes late across its last eight runs (read on 2026-10-16).

## Decision

1. **Run from Dot.Brain's own GitHub Actions, not the shared cPanel crontab.** Actions is where Brain's jobs already run (`guardian-cron.yml`) and sits outside the single shared file that failed. Its scheduler is best-effort, though: the 5-minute Guardian cadence needed an external dispatcher, and the hourly cron here has not been measured. `platform-collector.yml` already accepts `workflow_dispatch`, so if the first 48 hours show gaps the remedy is one more dispatch from that same worker (Open questions).
2. **Reuse `dot-guardian/v1`; introduce no new contract.** The health document already carries a status plus per-check `metrics`; a platform that wants to report usage numbers puts them there. Dot.Mines is covered with zero platform changes.
3. **A separate service, not a Guardian mode.** Guardian can deploy and roll back platforms; passive collection must not inherit that authority, and Guardian's manifests require repo and deploy configuration a collection-only platform has no reason to declare.
4. **Record to Dot.Memory's intelligence events endpoint**, one idempotent observation per platform per UTC hour (`event_id = collect-<platform>-<yyyymmddhh>`). What Memory's existing `GET /api/intelligence/context` returns for the subject today is the signature series (`status:*` / `failure:*` per hour) and the recurrence counts. The per-check `detail` (checks, metrics, reason, `generated_at`) is stored but no Dot.Memory route exposes it, so it is write-only until Memory does (Open questions).
5. **Failure semantics follow the purpose.** A platform being down is recorded as data and keeps the run green (alerting is Guardian's job); inability to record turns the run red, because silent staleness is the failure this job exists to prevent. An unset token is recorded as `config`, never skipped. A write is retried on network errors, 5xx and 403/408/429 (ADR-0016 measured a 6.6% edge-WAF 403 rate from GitHub runner IPs to this shared host, and Dot.Memory is on it, so treating 403 as terminal would turn one or two runs a day red on noise and teach the owner to ignore the signal); any other 4xx fails at once. Each platform is isolated: an unexpected throw in one platform's work becomes that platform's unrecorded row and a red run, never a lost hour for the others. A document whose `platform` differs from its manifest's is a `contract` failure.
6. **Reuse existing tokens.** `DOT_MINES_GUARDIAN_TOKEN` and `DOT_MEMORY_TOKEN` already exist as repository secrets; the collector adds a consumer, not a credential. The Memory token has two consumers (`guardian-cron.yml` and the collector), so one rotation touches both; its rotation is due about 2026-11-23 under [brain.security.md](../brain.security.md) §4.

## Consequences

- No new trust boundary: an authenticated, Brain-initiated read of operational signals, exactly what ADR-0014 established. That no raw business data is read or stored holds by contract with each platform's endpoint (operational signals only) and is not inspected by the collector: it stores any scalar metric and any message up to 240 characters, with no classification check.
- Enrollment is a manifest, a repository secret, and one workflow `env:` line — not one file. GitHub Actions cannot pass "whichever secrets the manifests name" without exposing all of them; a test fails CI if a manifest's `token_env` is missing from the workflow.
- GitHub's cron is best-effort and this job's real cadence is unmeasured, so "hourly" is the request, not a guarantee; late and duplicate runs are harmless by construction, a skipped hour is a gap.
- Other platforms enroll later by adding a manifest plus a `dot-guardian/v1` endpoint, each as its own PR in that platform's repository.

## Alternatives considered

- **A cPanel crontab line.** Rejected: Brain is not hosted there, and that crontab is a single shared file with a demonstrated wipe-everything failure mode.
- **An hourly mode inside Guardian.** Rejected: widens the blast radius of a service that can deploy, and couples collection-only platforms to remediation configuration.
- **A new `dot-usage/v1` contract.** Rejected as premature: nothing yet needs more than status plus metrics, and no platform other than Dot.Mines can serve an endpoint of its own today.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-16 | Brainstorming session | Initial decision record. |
| 1.0.1 | 2026-10-16 | Whole-branch review | Corrected the read-back claim (only the signature series and recurrence are readable through `context`; `detail` is not exposed) and the scheduler claim (GitHub's cron is best-effort; Guardian's cadence needed an external dispatcher). Decision 5 now records the 403/408/429 retries and per-platform isolation; Decision 6 the three Memory-token consumers and the rotation date; the no-raw-business-data statement is now by contract, not inspected; BluPin's health is served by Dot.Memory. New Open questions. |
| 1.0.2 | 2026-10-16 | BluPin retirement | BluPin is the holding company, not a Dot platform, and its signal engine was removed from Dot.Charts. The `blupin` manifest (day-one enrollment is now `dot-mines` only) and the `blupin-context` job were retired with it, so Guardian has one enrolled platform, the Memory token has two consumers (`guardian-cron.yml` and the collector), and the Dot.Memory `BlupinLoopReport` follow-up no longer applies. Earlier change-log rows are left as written. |

## Open questions

- **Measure the cadence for 48 hours after merge.** Compare each run's start time against minute 17 and count missed hours. If there are gaps, add an hourly `workflow_dispatch` of `platform-collector.yml` to the Cloudflare Worker that already drives Guardian; the workflow accepts it already.
- **Dot.Memory follow-ups**, each its own PR in that repository: expose an observation's `detail` through a route; and `context` returns a subject's whole history unbounded, so it needs a limit or window before it is read at hourly volume.
- Who watches the collector? Nothing yet notices if the schedule is disabled or a secret expires; a Guardian check on the age of the latest `platform` observation in Memory (≤ 2 h) is the natural fit, once the collector exists to be watched. GitHub also disables scheduled workflows in a public repository automatically after 60 days without repository activity, so a quiet repo can switch this job off with no error.
- This is a public repository, so the run logs and job summary expose each platform's reachability and status every hour. Accepted and noted: tokens are never printed and manifest errors never echo a URL.
- Retention: Dot.Memory has no pruning, and 24 rows per platform per day grows without bound. Fine at two platforms, worth a policy before ten.
- Whether Brain needs a shared cross-platform vocabulary for usage `metrics` keys, deferred until more than one platform reports usage.

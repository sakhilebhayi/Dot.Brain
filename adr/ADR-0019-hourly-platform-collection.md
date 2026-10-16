---
title: ADR-0019 — Hourly Platform Collection from Dot.Brain's GitHub Actions
version: 1.0.0
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

Dot.Brain should always know the current state of the live platforms. Today it has almost no recurring feed: Guardian (ADR-0014) polls every 5 minutes but exists to detect and remediate incidents: its working state lives in `actions/cache`, it archives only incidents — not a periodic state series — to Dot.Memory, and it has two platforms enrolled; Revenue Reader (ADR-0018) has none; the DKP publish/subscribe gateway is not a running service. The deployed apps share one cPanel crontab, which three simultaneous deploys wiped on 2026-10-16 (F-INFRA-2026-001); Dot.Brain is not hosted there.

## Decision

1. **Run from Dot.Brain's own GitHub Actions, not the shared cPanel crontab.** The Actions scheduler is Brain's established one (`guardian-cron.yml`, `blupin-context.yml`) and sits outside the single shared file that failed.
2. **Reuse `dot-guardian/v1`; introduce no new contract.** The health document already carries a status plus per-check `metrics`; a platform that wants to report usage numbers puts them there. Dot.Mines is covered with zero platform changes.
3. **A separate service, not a Guardian mode.** Guardian can deploy and roll back platforms; passive collection must not inherit that authority, and Guardian's manifests require repo and deploy configuration a collection-only platform has no reason to declare.
4. **Record to Dot.Memory's intelligence events endpoint**, one idempotent observation per platform per UTC hour (`event_id = collect-<platform>-<yyyymmddhh>`), read back through Memory's existing `context` endpoint.
5. **Failure semantics follow the purpose.** A platform being down is recorded as data and keeps the run green (alerting is Guardian's job); inability to record turns the run red, because silent staleness is the failure this job exists to prevent. An unset token is recorded as `config`, never skipped.
6. **Reuse existing tokens.** `DOT_MINES_GUARDIAN_TOKEN` and `DOT_MEMORY_TOKEN` already exist as repository secrets; the collector adds a consumer, not a credential.

## Consequences

- No new trust boundary: an authenticated, Brain-initiated read of operational signals, exactly what ADR-0014 established; no raw business data is read or stored.
- Enrollment is a manifest, a repository secret, and one workflow `env:` line — not one file. GitHub Actions cannot pass "whichever secrets the manifests name" without exposing all of them; a test fails CI if a manifest's `token_env` is missing from the workflow.
- GitHub's cron is best-effort, so "hourly" means roughly hourly; late and duplicate runs are harmless by construction, a skipped hour is a gap.
- Other platforms enroll later by adding a manifest plus a `dot-guardian/v1` endpoint, each as its own PR in that platform's repository.

## Alternatives considered

- **A cPanel crontab line.** Rejected: Brain is not hosted there, and that crontab is a single shared file with a demonstrated wipe-everything failure mode.
- **An hourly mode inside Guardian.** Rejected: widens the blast radius of a service that can deploy, and couples collection-only platforms to remediation configuration.
- **A new `dot-usage/v1` contract.** Rejected as premature: nothing yet needs more than status plus metrics, and no platform other than Dot.Mines can serve any endpoint today.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-16 | Brainstorming session | Initial decision record. |

## Open questions

- Who watches the collector? Nothing yet notices if the schedule is disabled or a secret expires; a Guardian check on the age of the latest `platform` observation in Memory (≤ 2 h) is the natural fit, once the collector exists to be watched.
- Retention: Dot.Memory has no pruning, and 24 rows per platform per day grows without bound. Fine at two platforms, worth a policy before ten.
- Whether Brain needs a shared cross-platform vocabulary for usage `metrics` keys, deferred until more than one platform reports usage.

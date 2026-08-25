---
title: ADR-0014 — Dot Guardian: Autonomous Monitoring & Remediation Architecture
version: 1.0.0
status: active
owners: [Chief Architect, Sakhile Bhayi]
last-review: 2026-08-25
---

# ADR-0014 — Dot Guardian: Autonomous Monitoring & Remediation Architecture

Purpose: record the decision to implement the ecosystem's autonomous production guardian as three cooperating pieces — a per-platform `dot-guardian/v1` health contract, a registry-driven orchestrator service in this repository (`services/guardian`), and an ops-incident archive API in Dot.Memory — with remediation flowing exclusively through each platform's own GitHub repo and existing CI/CD workflow.

> **Related documents:** [../services/guardian/README.md](../services/guardian/README.md) · [../brain.resilience.md](../brain.resilience.md) · [../brain.autonomy.md](../brain.autonomy.md) · [../schemas/incident.schema.json](../schemas/incident.schema.json) · [../platforms/guardian/dot-mines.json](../platforms/guardian/dot-mines.json) · [../docs/superpowers/plans/2026-08-25-dot-guardian.md](../docs/superpowers/plans/2026-08-25-dot-guardian.md)

---

## Status

Accepted — 2026-08-25

## Context

Dot.Mines runs real production workloads (fleet telemetry, Bell and 24 other manufacturer integrations, production counters) on shared hosting with a database queue drained by cron ticks. Its worst historical failures were silent: pages kept loading while 996 queued jobs piled up unserviced, and syncs stopped without anything turning a page red. Liveness probes (`/health`, `/up/realtime`) cannot see that class of failure. Meanwhile Dot.Brain's doctrine (manifesto rule 6, `brain.resilience.md`) demands every incident become a reusable knowledge asset, and rule 4 forbids Dot.Brain from touching platform-owned files outside PRs. The owner asked for a 24/7 guardian for Dot.Mines that must generalize to every Dot platform without rework.

## Decision

1. **A per-platform health contract, not a central scraper.** Each platform serves `GET /guardian/health` (bearer-token, fails closed) returning per-check `healthy|warning|critical|unknown` with metrics. The platform owns its checks; the guardian owns nothing platform-specific. Dot.Mines' implementation adds data-liveness checks (integration sync recency, telemetry ingestion, production freshness) precisely because "running but not updating" is its real failure mode.
2. **The orchestrator is a Dot.Brain service following the existing service pattern** (`services/guardian`: Node ≥ 22.5 ESM, zero npm dependencies, `node:sqlite` state, `node --test`), not a new platform. Registry-driven: enrolling a platform is one manifest in `platforms/guardian/`, validated by tests. Manifest keys carry the autonomy level, deploy workflow, attempt/deploy budgets, and protected areas.
3. **Remediation goes only through GitHub + the platform's existing CI/CD.** The guardian triggers the platform's own deploy workflow (`gh workflow run`, with the workflow's confirm inputs) and opens/merges PRs only after `gh pr checks` reports green. No parallel deployment mechanism, no SSH, no direct production mutation. Rollback reverts the guardian's own recorded deployment range via a revert PR through the same pipeline.
4. **Progressive autonomy with hard, unit-tested gates.** Levels 1–4 per manifest; autonomous execution requires level ≥ 3 ∧ confidence ≥ 0.6 ∧ risk ≤ 0.4 ∧ deploy budget; sev1 infrastructure failures always escalate; two failed verifications open a per-platform circuit breaker requiring human reset; `max_fix_attempts` caps the fix loop. Novel code fixes are never autonomous at any level — only registered runbooks and previously-validated actions run unattended; everything else becomes a recommendation or escalation issue.
5. **Dot.Memory stores the guardian's long-term memory as data-plane archives.** New `/api/ops/incidents` + `/api/ops/recall` endpoints (Sanctum service token). Envelope columns (platform, signature, severity, status, timestamps, result enums) exist solely for the publisher's own retrieval and success-rate aggregation; all narrative detail lives in one `record` blob, encrypted at rest — preserving Dot.Memory's "store without reading" boundary (its wiki §2). Recall feeds the decision engine's confidence: the guardian only earns autonomy on a signature by having fixed it before.
6. **Severity vocabulary and incident lifecycle align with `schemas/incident.schema.json`** (`sev1..sev4`), so guardian incidents can later publish as DKP incident reports without translation.

## Consequences

- Dot.Mines gains detection of its historically silent failures, and every incident — resolved, rolled back, or escalated — accumulates in Dot.Memory, making the decision engine measurably better over time (success-rate-driven confidence).
- A new platform enrolls with ~10 lines of JSON plus a health endpoint; the architecture needs no change (manifesto rule on registry-driven extensibility holds).
- The guardian is only as capable as the platform's CI/CD: platforms without a dispatchable deploy workflow cap out at recommend-level autonomy. That is deliberate — building a second deploy path was rejected.
- `gh`/`git` become runtime dependencies of the guardian host (not of any platform), and the GitHub token is the highest-value secret in the system; it must stay least-privilege (enrolled repos only).
- Verification quality depends on the health contract's honesty; a check that lies "healthy" defeats rollback. Mitigated by measuring outcomes (telemetry/production freshness read the tables, not the sync pipeline's self-report).
- `platforms/guardian/dot-mines.json` ships at `autonomy_level: 2` (recommend). Raising it to 3 requires exercising the e2e scenario suite against staging first; a registry test enforces the ceiling until that decision is recorded here.

## Alternatives considered

- **Extend Sentry/uptime monitoring with alert webhooks into a fixer bot.** Rejected: covers exceptions and downtime but not silent data-staleness, and ties the reasoning loop to a vendor's alert shape instead of an owned, platform-agnostic contract.
- **A Laravel "guardian" module inside Dot.Mines that self-heals.** Rejected: the platform cannot be trusted to diagnose itself when its own scheduler/queue is the thing that died, and nothing would generalize to other platforms.
- **Direct SSH remediation from the guardian host.** Rejected outright: bypasses CI, unauditable, and violates the manifesto's PR-only boundary.
- **Storing incident narratives as first-class queryable columns in Dot.Memory.** Rejected: breaks the store-without-reading invariant; the envelope/opaque-blob split keeps aggregation possible without content inspection.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-25 | Chief Architect session | Initial decision record. |

## Open questions

- When the e2e scenarios have run against real staging, does dot-mines move to autonomy level 3 wholesale, or per-runbook (redeploy first, rollback later)?
- Should resolved guardian incidents auto-publish as DKP `incident` Knowledge Packs once the DKP pipeline is live?
- Where does the guardian host run in production (the owner's machine vs. a scheduled GitHub Action in this repo), and what supervises `guardian watch`?

---
title: ADR-0016 — Classifying Health-Fetch Failures
version: 1.0.0
status: active
owners: [Chief Architect, Sakhile Bhayi]
last-review: 2026-08-26
---

# ADR-0016 — Classifying Health-Fetch Failures

Purpose: record why the guardian stopped treating every failed health fetch as an outage, and the rules it uses instead.

## Context

`fetchHealth` returned `{ reachable: false, reason }` for every failure mode, and `normalizeChecks` turned all of them into a single synthetic `availability` check at `critical`. Because `availability` is one of the two `INFRASTRUCTURE_CHECKS`, `severityFor` made it **sev1**, and `evaluate` escalates every sev1 with *"platform or database unreachable — infrastructure incident, not code-fixable from GitHub"*.

On 2026-08-25/26 this raised four sev1 "human needed" incidents against Dot.Mines (issues #179, #180, #183, #190). All four recorded the same cause:

```
"message": "Platform health endpoint unreachable: HTTP 403"
```

The platform was never down. A 403 means the request reached the server and was refused, and it did not come from the application: `AuthenticateGuardian` returns 401 for a bad or missing token and 503 when unconfigured, and has no 403 path. The 403 originated at the host's edge (cPanel WAF) transiently blocking the GitHub Actions runner IP — roughly 4 blocks in 1,150 polls, and not reproducible across five user agents.

Two failures compounded: a wrong classification, and no tolerance for a single bad poll.

## Decision

**1. Failures are classified by what actually happened.**

| Kind | Trigger | Reported as | Severity |
| --- | --- | --- | --- |
| `unreachable` | DNS, refused, timeout — nothing answered | `availability` critical | sev1 |
| `platform_error` | 5xx other than 503 | `availability` critical | sev1 |
| `maintenance` | 503 | `maintenance` warning | sev3 |
| `access` | 401, 403, other 4xx | `access` warning | sev3 |
| `config` | 404, or token env unset | `access` critical | sev2 |
| `contract` | answered, but not dot-guardian/v1 | `contract` warning | sev3 |

`availability` and `database` remain the only members of `INFRASTRUCTURE_CHECKS`. Everything else in that table means *something answered*, which is the opposite of an outage, so none of it can reach sev1.

**2. A single failed poll is not an incident.**

The kinds that would page at sev1 — plus `maintenance`, because our own deploys emit 503 for a minute or two — are gated behind consecutive failures. Below the threshold the synthetic check reports `unknown`, which `reconcile` neither opens nor closes on. The streak is per platform, stored in the `reachability` table, incremented before reconciliation so it includes the poll being reconciled, and reset by any successful fetch.

Threshold defaults to 2 and is overridable per platform via `availability_threshold` in the manifest.

`access`, `config` and `contract` are deliberately **not** gated: they are real the first time they happen, and they are already sev3/sev2, so reporting them immediately costs nobody a night's sleep.

## Consequences

- All four of the incidents that motivated this would have been suppressed: a lone 403 now yields no incident at the first poll and an `access` sev3 recommendation if it persists.
- A genuine outage is reported one poll later than before — at a 5-minute cadence, five minutes. That is the price of not crying wolf, and it is worth paying.
- Our own deploys stop being able to raise availability incidents.
- `verify.js` is unchanged: during post-deploy verification any non-reachable result still counts as a failure, because there the question is "can we confirm the fix", not "is the platform down".

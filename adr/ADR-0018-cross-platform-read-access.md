---
title: ADR-0018 — Cross-Platform Read Access via the dot-revenue/v1 Contract
version: 1.0.1
status: active
owners: [Chief Architect]
last-review: 2026-09-23
---

# ADR-0018 — Cross-Platform Read Access via the dot-revenue/v1 Contract

Purpose: record the decision to give Dot.Brain its first Brain-initiated pull path — a scoped, manifest-enrolled capability for reading pre-aggregated business signals from platforms — and the explicit, narrow exception this carves into the ingest-only trust boundary.

> **Related documents:** [docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md](../docs/superpowers/specs/2026-09-23-cross-platform-read-access-design.md) — the full design · [ADR-0014-dot-guardian-architecture.md](ADR-0014-dot-guardian-architecture.md) — the contract shape this reuses · [ADR-0017-outbound-insight-delivery.md](ADR-0017-outbound-insight-delivery.md) — the reasoning pipeline this feeds · [../brain.architecture.md](../brain.architecture.md) · [../brain.security.md](../brain.security.md) · [../services/revenue-reader](../services/revenue-reader/README.md) — reference implementation.

---

## Status

Accepted — 2026-09-23

## Context

No platform publishes revenue-relevant Knowledge Packs today, and Dot.Billing — the platform that owns settlement data — exposes nothing live at all: settlement data currently leaves only via batched DKP packs (`dot-billing.md:42-49`), with no on-demand read surface. Waiting for every platform to redesign its DKP publishing schedule and schema around revenue-shaped signals is slower and less controllable than Brain being able to ask directly.

That is a real boundary change. `CLAUDE.md` Rule 4 states Brain "ingests published Knowledge Packs and responds with Pull Requests" — a live-pull channel is a third mode that sentence does not describe, and today's trust-boundary docs describe zero Brain→platform pull path in either direction (`brain.architecture.md:133`, `brain.security.md:30-47`).

Dot Guardian (`ADR-0014`) is the one existing production precedent for a Dot.Brain-owned service reading live data from a platform, and its contract shape already satisfies Brain's security bar: manifest-based enrollment needing no architecture change per platform, a scoped bearer token per platform that fails closed when unset, and defensive contract validation that never trusts a response body blindly.

## Decision

1. **A new, narrow pull path, not a reinterpretation of the ingest boundary.** DKP publishing is unchanged; this adds a second, independent inbound mechanism scoped exactly to pre-aggregated business signals.
2. **Reuse Guardian's contract shape.** Manifest-based enrollment (`platforms/revenue-reader/<platform>.json`), a scoped bearer token per platform (`token_env`, fails closed), defensive validation that rejects rather than partially trusts a malformed response.
3. **Platforms expose signals, never raw records.** A platform's own code decides what a signal aggregates over; Brain never receives transaction- or PII-level data, satisfying the cross-tenant confidentiality rule (`brain.governance.md:101`).
4. **Nothing raw is persisted.** A poll result lives only for the span of one reasoning pass; only a derived Insight or Recommendation is written to the graph, with an `evidence` entry of kind `external` pointing back to the read, never the payload itself.
5. **Classification is enforced twice.** Every response declares its own `classification`; a manifest also declares a `classification_ceiling`, and a response exceeding it is rejected outright — a rejection mode Guardian's operational-signal-only contract never needed. Recording that rejection as a standing, escalatable incident (rather than a structured `{ok: false}` result returned to the caller, which is what ships today) is a deferred extension; see Open questions.
6. **A distinct token namespace from Guardian's.** Same token shape, but named so a revenue-signal token can never be confused with or substituted for a Guardian health-check token, given the higher stakes of financial data.

## Consequences

- Dot.Brain gains a second inbound mechanism alongside DKP publishing — `brain.architecture.md` and `brain.security.md` are updated to describe it as an explicit, bounded exception, not a general capability.
- A future Revenue Intelligence module can consume `services/revenue-reader`'s poll results as a new input to the existing W3 reasoning → W4 gates → Insight/Recommendation pipeline, unchanged.
- No platform is obligated to enroll; a platform that never adds a manifest is entirely unaffected.
- Building any platform's actual `dot-revenue/v1` endpoint (starting with Dot.Billing) is separate, coordinated work outside this repository.

## Alternatives considered

- **Extend DKP publishing cadence/schema instead.** Rejected: does not give Brain control over *when* it asks, and depends on every platform independently redesigning its own publishing schedule.
- **Wait for platforms to adopt revenue-shaped DKP packs organically.** Rejected as too slow and uncontrollable, given the explicit choice for live access over the ingest-only model for this specific capability.
- **A structurally new token/credential system for this capability.** Rejected: `brain.security.md:70,74` establishes one key system ecosystem-wide with no shared secrets between platforms; a second key system would violate that directly. Same token shape as Guardian's, under a distinct naming convention, satisfies the stated need for separation without duplicating the key system.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-23 | Brainstorming/planning session | Initial decision record. |
| 1.0.1 | 2026-09-23 | Post-merge repeat-check | Decision 5's "rejected outright as an incident" overstated what shipped: a `classification_ceiling` breach is rejected and returned as a structured `{ok: false, kind: 'classification_ceiling'}` result, not recorded as a standing incident anywhere (Guardian's own incident store is local SQLite state that nothing in this capability writes to). Corrected the wording and moved incident-escalation to Open questions as a deferred extension needing its own design. (Front-matter version was not bumped alongside this row when it was first written — corrected now.) |

## Open questions

- Exact default `poll_interval_s` and per-signal staleness semantics (a `valid_until` per signal) — `3600` is a starting default, to be revisited once a real platform enrolls.
- Whether `classification_ceiling` should also be asserted platform-side as a hard manifest requirement, in addition to Brain-side enforcement, for defense in depth.
- Whether a `classification_ceiling` breach should be escalated beyond the caller-visible rejection result — e.g. written to Dot.Memory as an auditable incident, or raised as a GitHub issue mirroring Guardian's `escalate.js` — and if so, by what mechanism. Not yet designed or built; the capability today rejects the response and reports it to whatever calls `pollPlatform` (the CLI prints it to stderr), nothing more.

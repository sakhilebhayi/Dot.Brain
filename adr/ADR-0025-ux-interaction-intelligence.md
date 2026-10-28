---
title: ADR-0025 — User Interaction Intelligence (R-12): A Privacy-Minimised Event Contract First, Placement and Measurement Left to the Owner
version: 1.0.0
status: proposed
owners: [Chief Architect]
last-review: 2026-10-28
---

# ADR-0025 — User Interaction Intelligence (R-12): A Privacy-Minimised Event Contract First, Placement and Measurement Left to the Owner

Purpose: record what the first increment of R-12 (a closed-loop UX improvement engine extending the Brand Feeling Engine) builds, what it deliberately does not build, and the decisions that only the owner can make before any product emits an event.

> **Related documents:** [ADR-0021-brand-feeling-engine.md](ADR-0021-brand-feeling-engine.md) — the engine this extends; recommends, never ratifies; Dot.Brain has no running service · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — observation, decision, action, outcome · [../schemas/ux-interaction-event.schema.json](../schemas/ux-interaction-event.schema.json) — the event shape · [../services/ux-interactions/README.md](../services/ux-interactions/README.md) — the contract package · [../brain.governance.md](../brain.governance.md) — decision rights and the ethics gate · [../brain.dopemine.md](../brain.dopemine.md) — ethical engagement

---

## Status

Proposed — 2026-10-28. Written by an AI session for the owner's review. Nothing here is ratified. The owner's brief (R-12, stored verbatim in the InfoDot docs) is the requirement; this record is the first engineering response to it.

## Context

R-12 asks for a loop that observes how people actually use the platforms, finds friction (repeated clicks, abandoned workflows, empty searches, repeated errors, slow requests), proposes improvements, measures whether they worked, and feeds that back. The risks are specific: interaction telemetry is easy to over-collect, and under POPIA a free-text field (a search query, an error message, a URL with a query string) is where personal information leaks in. Dot.Brain has no running service (ADR-0021), so it cannot be where events are received. No platform emits interaction events today.

## Decision

1. **Build the contract before the pipeline.** `services/ux-interactions` and `schemas/ux-interaction-event.schema.json` define one event shape, version 1.0.0, as a package and files only, in line with how Dot.Brain ships.
2. **Minimisation by construction.** No field can carry free text. Every string is a closed enum or a strict pattern; unknown fields are refused. Search carries a query length and a result count, never the query. Routes are templates without ids or query strings. The session is a pseudonymous rotating identifier, never a user id; the tenant, when present, is a uuid.
3. **A validator as a net on top.** Detectors (email, token, URL or query, phone, card number, South African ID number) reject an event with a reason code and never echo the value, so a rejection log cannot leak what it rejected.
4. **Events are bounded.** 2 KB per event, 50 events per batch, a seven-day past window and a five-minute future window, and an idempotency key from product and event id so a retry is stored once.
5. **Consent basis is part of the event.** `consent.basis` is required: `consent`, `contract`, `legitimate_interest` or `aggregate_only`. Which basis applies per product is for the owner and a POPIA adviser, not this package.
6. **No emitter, collector or dashboard in this increment.** Adding a tracker to a product, a collection endpoint or a store is a separate change with its own review, after the decisions below.
7. **Advisory only.** Findings from this data will, like the Brand Feeling Engine's, recommend and never ratify or change a product by themselves.

## Decisions the owner must make (not decided here)

| # | Question | Options | Author's recommendation (not a decision) |
|---|---|---|---|
| D1 | Who measures: where does the loop run? | (a) Dot.Analytics ingests the events (it already takes signed daily aggregates); (b) the Dot.Memory intelligence loop (ADR-0015) records the observation and outcome stages; (c) Dopemine acts on certified mechanics | Analytics stores and aggregates, Memory records the decision and outcome of each change, Brain keeps the contract and rules. One owner per concern. |
| D2 | Where does the dashboard live? | Analytics, Central, or a Brain-generated report committed to a repository (Brain has no runtime) | Analytics, since it already has the data path and sign-in; Central only if the audience is the control room. |
| D3 | Events or aggregates? | Raw events kept for a period, or only daily aggregates (counts per route, type and status) | Aggregates by default; raw events with a short retention (days) only where a finding needs a sequence, such as a workflow abandon. |

Also the owner's: retention periods per data class, the consent basis per product, and whether any event may go to a processor such as Anthropic (the recommendation is no).

## Consequences

- A product team can see exactly what may be emitted and gets a precise rejection reason otherwise.
- A POPIA adviser can review one small contract before any data exists.
- Adding a type, a field or an enum value is a visible version change.
- Nothing measures anything yet. R-12 is not delivered by this increment; it has a contract only.

## Alternatives considered

- **A free-form `properties` bag, as most analytics SDKs have.** Rejected: that is where personal information gets in.
- **Redaction after collection.** Rejected as the primary control: minimisation by construction can be checked in review, redaction cannot.
- **An off-the-shelf product analytics service.** Not decided here; it sends interaction data to a third party and needs the s72 decision first.
- **A collector inside Dot.Brain.** Rejected: Brain has no runtime (ADR-0021).

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-28 | AI session (for owner review) | First draft: contract, schema, validator, open decisions D1–D3 |

## Open questions

- D1, D2 and D3 above.
- Retention periods and consent basis per product.
- Whether the session identifier rotates per visit or per day.

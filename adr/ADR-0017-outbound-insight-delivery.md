---
title: ADR-0017 — Outbound Insight Delivery via Pull API and Notify-Routed Push
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-09-19
---

# ADR-0017 — Outbound Insight Delivery via Pull API and Notify-Routed Push

Purpose: record the decision to give Dot.Brain a second outbound path — a gate-cleared, non-structural Insight — and specifically why push delivery is routed through Dot.Notify rather than built as new infrastructure inside Dot.Brain.

> **Related documents:** [docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md](../docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md) — the full design · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — the envelope this reuses, and the duplication precedent this ADR follows · [../brain.workflows.md](../brain.workflows.md) §4–5 · [../brain.api.md](../brain.api.md) · [../platforms/dot-notify.md](../platforms/dot-notify.md) · [../services/insight-delivery](../services/insight-delivery/README.md) — reference implementation.

---

## Status

Accepted — 2026-09-19

## Context

Dot.Brain's only outbound path was the PR Generator, scoped exclusively to structural changes a platform reviews and merges. There was no path for Brain to surface a purely informational, time-relevant finding — and the ecosystem's stated product direction (Dot.Brain as an always-on intelligence engine that *feeds* every platform, not only one that platforms poll or that only writes back via PR) requires one.

Dot.Notify already exists as "the shared last mile — delivery of alerts, digests, and messages on behalf of every other platform" (`platforms/dot-notify.md` §1), with consent, channel selection, precision-gating, and fatigue throttling already built and running in production. ADR-0015 already rejected a comparable duplication — Dopemine as a general execution/delivery layer — on exactly this principle.

## Decision

1. **Two outbound paths, not three.** Structural changes still go only through the PR Generator, unchanged. A new, narrower path — Insight Delivery — handles informational content. No third, bespoke channel is built.
2. **Pull is owned by Brain.** `GET /v1/insights/{id}` and `GET /v1/insights/search` follow the existing Query API's exact conventions (auth, classification filtering, versioning).
3. **Push is routed through Dot.Notify, not built by Brain.** Brain emits an ADR-0015 intelligence-loop `action` envelope with `executor_platform: "dot-notify"`; Notify owns channel selection, consent, and throttling, exactly as it already does for every other platform.
4. **Insight candidates pass Ethics and Security, and skip Governance.** Nothing is applied to a platform by an Insight, so there is no decision-rights question — the same principle that lets Query API reads skip Governance today.
5. **The outcome stage reuses Notify's existing delivery events.** `messaging.delivery.acted/ignored` already carries what the intelligence-loop's `outcome` stage needs; no new outcome-tracking mechanism is introduced.

## Consequences

- Dot.Notify's existing consent and throttling model now also governs Insight delivery, for free — Brain inherits that maturity instead of re-implementing a weaker version of it.
- `insight.schema.json` gains a second producer (Brain itself, not only platforms publishing in) without any schema change.
- A future platform that wants Insights only needs to implement the pull surface; push is opt-in via its existing Notify integration.
- Brain's architecture invariant changes from "one outbound path" to "two outbound paths, each narrowly scoped" — `brain.architecture.md` §2–3 updated accordingly.

## Alternatives considered

- **A bespoke Brain-owned webhook/subscription system.** Rejected: duplicates Dot.Notify's exact job, the specific anti-pattern ADR-0015 already named and rejected for Dopemine.
- **Push-only, no pull surface.** Rejected: forces every platform to integrate Notify just to see Insights at all, with no fallback when a webhook endpoint is down.
- **Routing Insights through the intelligence-loop's risk/confidence `reason()` gate** (the same gate that decides autonomous remediation). Rejected: that gate models whether Brain may autonomously perform a *consequential* action based on a subject's track record; an Insight has already been vetted by Ethics/Security at classification time, and forcing it through an unrelated confidence gate would mean a brand-new `action_kind` with no track record could never autonomously deliver, contradicting the whole point of the design.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-19 | Brainstorming/planning session | Initial decision record. |

## Open questions

- Should a platform be able to opt out of push delivery entirely (pull-only), or is that already covered by Notify's existing consent model at the recipient level?
- Does `insight.deliver` need its own rate limit (mirroring the PR Generator's per-platform PR budget), or is Notify's existing fatigue throttling sufficient on its own?

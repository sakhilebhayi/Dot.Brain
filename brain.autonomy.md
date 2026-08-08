---
title: Dot.Brain — Autonomy Foundation (Owner Independence Classification & Measurement)
version: 1.0.0
status: draft
owners: [Business Agent]
last-review: 2026-08-08
---

# brain.autonomy — Autonomy Foundation

Purpose: the shared contract for the ecosystem-wide Owner Independence program spanning Houz of Sax Trust → BluPin → Dot → individual Dot platforms. Defines what "autonomous" means, how it is classified, how it is scored, and the honesty rules that bind every future sub-project built against this contract. This document defines vocabulary and rules; it does not itself classify any real process — that is future, platform-by-platform work.

> **Related documents:**
> - [brain.governance.md](brain.governance.md) — the approval-tier framework this document's Level 2/3 escalation borrows its shape from, without inheriting its agent-colony machinery.
> - [brain.cushion.md](brain.cushion.md) — the sibling honesty pattern (`insufficient_data` over fabrication) this document's §3 unmeasured-category rule follows.
> - [brain.platforms.md](brain.platforms.md) — the platform registry; per-platform classification audits (future work) live in `platforms/<platform>.md`, registered there.

---

## §1 Organisational boundaries

Houz of Sax Trust, BluPin, Dot, each individual Dot platform, customers, and external partners are separate entities. Nothing built against this contract may blur, across those boundaries: ownership, governance, financial accounts, legal entity, data ownership, permissions, liability, or regulatory responsibility. Any future capability that moves data or authority across an entity boundary must name the boundary it crosses explicitly in its own spec — this document does not pre-authorize any cross-entity access.

## §2 Three-level autonomy classification

Every process, on every platform and in every entity, is classified as exactly one of:

- **Level 1 — Autonomous.** Executes without owner approval. Examples: routine marketing, content research, SEO, monitoring, reporting, lead qualification, onboarding, routine support, internal task management, documentation, diagnostics, safe automated remediation, routine analytics.
- **Level 2 — Escalate.** The system analyses and prepares the action but requires authorised human approval before it executes. Every Level 2 proposal presents, in order: Context → Evidence → Risk → Recommendation → Proposed Action. Examples: significant spending, pricing changes, partnerships, contract changes, high-value sales, sensitive customer communications, material resource allocation, significant hiring.
- **Level 3 — Human Control.** The owner holds explicit, non-delegable authority. Nothing built under this program may execute these autonomously. Examples: legal ownership, trust/fiduciary decisions, banking authority, major financial commitments, regulatory submissions, legal agreements, security credential ownership, destructive operations, permanent deletion, strategic direction, major corporate restructuring.

A process's classification is a property of the process, recorded wherever that process is implemented (e.g. a platform's `platforms/<name>.md` states which of its real processes are L1 vs L2 vs L3). This document is the shared vocabulary, not a registry — no central list is maintained here.

## §3 Autonomy Score

Weighted categories (sum to 100%):

| Category | Weight |
|---|---:|
| Governance | 10% |
| Operations | 10% |
| Technology | 10% |
| Marketing | 10% |
| Sales | 10% |
| Customer Experience | 10% |
| Finance | 10% |
| Security | 10% |
| Resilience | 10% |
| Knowledge | 5% |
| Learning | 5% |

**Honesty rule, binding on every future consumer of this formula:** a category with no real underlying signal scores **0** for that entity, full stop. It is never excluded from the weighted average and never assigned a default, neutral, or estimated value. A dashboard may (and should) visually distinguish "0 — capability does not exist yet" from "0 — capability exists and is failing," but both contribute 0 to the number. Excluding unmeasured categories from the denominator would let a barely-started entity's score overstate its real maturity — the exact failure §7 exists to prevent.

## §4 Per-entity scoring

A score is computed separately for Houz of Sax Trust, BluPin, Dot (the ecosystem layer), and each individual Dot platform. There is no single blended "ecosystem score" that a strong entity's number can average out a weak one behind. An ecosystem-level view (a future dashboard) presents all scores side by side, never collapsed to one figure.

## §5 Autonomy intervals and gates

Progression sequence (days): 1 → 3 → 7 → 14 → 30 → 60 → 90 → 120 → 180 → 270 → 365 → Continuous. An entity advances to the next interval only after passing the gate for its current one:

- **Green — advance:** Autonomy Score ≥ 90, no unresolved critical incident, no major security failure, no uncontrolled financial loss, no critical customer failure, owner interventions below threshold, required monitoring operational, recovery procedures tested.
- **Yellow — repeat:** Score 75–89, minor recurring failures, owner dependency still too high, or important automation gaps remain. Repeat the same interval.
- **Red — reduce:** Score < 75, a critical incident occurred, security controls failed, material financial exposure occurred, a customer-critical process failed, or owner intervention became routine. Drop to a shorter interval.

A failure is never hidden to preserve a gate result or advance the schedule.

## §6 Owner-Free Operating Streak

Once an entity has real interval history, it gets a streak: current consecutive days without a **routine** owner intervention, and the longest streak on record. A **strategic** intervention (the owner making a Level 3 decision, or reviewing/approving a Level 2 escalation the system correctly routed to them) does **not** reset the streak — that's the system working as designed. A **routine** intervention (the owner doing something a Level 1 process should have handled, or being pulled in because automation failed) resets it to zero. This classification is recorded on each Owner Intervention Log entry (§8).

## §7 Never hide a weak entity behind a strong one

Restates §4 as a standing rule: ecosystem-wide reporting must always surface every entity's individual score. A high Dot-platform average must never be presented in a way that obscures a Houz of Sax or BluPin score of 0.

## §8 Owner Intervention Log — what it is for

The mechanism that makes owner dependency measurable at all. Every time the owner has to act on something that was expected to run autonomously (or approve something a well-functioning Level 2 process routed to them), an entry gets recorded — by a Claude session doing the work, or by the owner directly for interventions that happened outside any session. Implemented in `services/intervention-log/` (see its own README for the CLI). A valid entry requires:

- **entity** — which of Houz of Sax / BluPin / Dot / a specific platform name this intervention concerned.
- **category** — `routine` or `strategic` (drives §6).
- **problem, trigger, root_cause** — what happened and why, in enough detail that a later session can act on it without re-investigating.
- **why_automation_failed** — required even when the honest answer is "this was never automated" — that answer is itself the signal this program exists to surface.
- **recommended_permanent_solution** — the point of logging an intervention is to eventually stop needing it; every entry proposes how.

## §9 Anti-fabrication rules (binding on this entire program)

Never fake revenue, customers, or engagement; never manufacture testimonials; never hide failures, manipulate metrics, or suppress incidents; never mark incomplete work complete; never treat agent activity itself as business success. The objective of every sub-project under this program is to **discover** whether autonomy exists, not to **prove** that it does.

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-08 | Autonomy Foundation sub-project | Initial contract: organisational boundaries, three-level classification, Autonomy Score formula with unmeasured-category-scores-zero rule, per-entity scoring, interval/gate thresholds, Owner-Free Operating Streak rule, Owner Intervention Log content requirements, anti-fabrication rules. |

## Open Questions

- Should platform-level Level 1/2/3 classification live as a new section inside each existing `platforms/<name>.md`, or as a separate file? (Deferred to the classification-audit sub-project.)

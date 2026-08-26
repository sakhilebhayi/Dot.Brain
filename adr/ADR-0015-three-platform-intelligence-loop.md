---
title: ADR-0015 — Memory / Brain / Dopemine as One Intelligence Loop
version: 1.0.0
status: active
owners: [Chief Architect, Sakhile Bhayi]
last-review: 2026-08-26
---

# ADR-0015 — Memory / Brain / Dopemine as One Intelligence Loop

Purpose: record the division of responsibility between Dot.Memory, Dot.Brain and Dot.Dopemine, the single envelope they exchange, and the deliberate narrowing of Dot.Dopemine's role within it.

> **Related documents:** [../schemas/intelligence-loop.schema.json](../schemas/intelligence-loop.schema.json) · [ADR-0014-dot-guardian-architecture.md](ADR-0014-dot-guardian-architecture.md) — the working precedent this generalizes · [../brain.memory.md](../brain.memory.md) · [../platforms/dot-dopemine.md](../platforms/dot-dopemine.md)

---

## Status

Accepted — 2026-08-26

## Context

The ecosystem had three platforms whose responsibilities overlapped in description but not in code: Dot.Memory (storage substrate plus, since 0.7.0, a knowledge platform over the guardian's incident archive), Dot.Brain (reasoning and orchestration specs, plus one real service — the guardian), and Dot.Dopemine (an ethics-gated catalog of engagement mechanics). Nothing named the contract between them, so each new capability risked re-implementing the others' jobs.

Crucially, the loop is not hypothetical: the Dot.Mines guardian has been running exactly this cycle in production since 2026-08-25 — incidents archived in Dot.Memory, a decision engine in Dot.Brain weighing severity against confidence and risk, execution through the platform's own CI/CD, outcomes written back, and recall sharpening the next decision. What was missing was the generalization.

## Decision

1. **One envelope, one source of truth.** `schemas/intelligence-loop.schema.json` defines every stage of the cycle (observation → context → decision → action → outcome) in a single record keyed by `loop_id`. Any platform joins by emitting and consuming that envelope; no bilateral formats.

2. **Responsibilities are exclusive, not merely nominal.**
   - **Dot.Memory remembers.** Evidence, decisions-as-recorded, actions-as-recorded, outcomes, recurrence, learned success rates. It answers "what do we know, what was tried, what worked". It does not reason and does not execute.
   - **Dot.Brain thinks.** It asks Memory for context *before* deciding rather than rediscovering what is already known, and emits a decision carrying recommendation, rationale, confidence, risk and autonomy level. It is not the durable store.
   - **The executor acts.** It performs and reports; it does not decide.

3. **Dot.Dopemine's role is narrowed to engagement interventions — deliberately.** The spec that prompted this work described Dopemine as the ecosystem's general action layer (call APIs, update systems, remediate). We reject that reading. Dopemine's product *is* the mechanism the ecosystem exists to keep in check, and its own charter takes "the strictest possible reading" of that constraint. A platform that certifies engagement mechanics against an acid test cannot also be the place arbitrary automation runs without dissolving the gate that gives it value. Dopemine therefore executes **engagement interventions** — retention follow-ups, recognition, progress scaffolding — each bound to a *certified* mechanic, which is precisely the worked example the spec itself uses. Other execution routes to the platform that owns it: deployments through the platform's CI/CD (as the guardian already does), notifications through Dot.Notify, tasks through Dot.Tasks. This satisfies the spec's own §9 ("do not allow the platforms to duplicate each other") more faithfully than the literal reading would.

4. **The ethics gate is not bypassable by the loop.** An action naming an uncertified mechanic is refused and the refusal recorded, never silently downgraded.

5. **Autonomy is a ladder, and high risk never climbs it alone.** observe → recommend → approve → execute → autonomous, mirroring the guardian's proven gates. Autonomous execution is reserved for low-risk, previously-validated situations where Memory can evidence prior success.

6. **Learning is measured, not asserted.** An outcome verdict is required to grade a decision; the success rates Memory serves back are computed from recorded outcomes, so confidence rises only on evidence.

## Consequences

- Dot.Memory becomes more valuable the longer the ecosystem runs, which is the intended long-term value proposition — but only where outcomes are actually recorded. A loop that never reports its outcome teaches nothing, so outcome recording is a first-class endpoint rather than an optional epilogue.
- Dot.Brain can be improved (better reasoning) without migrating data, and Dot.Memory can be re-tiered without touching reasoning.
- Any future platform joins by implementing the envelope; the ecosystem does not change shape to admit it.
- The narrowing in decision 3 means "who executes X" must be answered per action kind. That is a real ongoing cost, accepted because the alternative — one platform executing everything — recreates the coupling this ADR exists to prevent.
- The guardian remains the reference implementation; where it and this contract disagree, the contract is the one that generalizes and the guardian should converge on it.

## Alternatives considered

- **Dopemine as the universal execution layer (the literal spec).** Rejected per decision 3.
- **Brain owning the durable store.** Rejected: it collapses Memory into a cache and loses the tiering/forgetting policy Memory exists to operate.
- **Bilateral APIs between each pair.** Rejected: three platforms need three contracts, twenty need one hundred and ninety. One envelope scales.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-26 | Chief Architect session | Initial decision record. |

## Open questions

- Where does the approval UI live for `requires_approval` actions — each platform, or one ecosystem-wide queue?
- Should outcome verdicts be graded automatically from a measure delta, or always asserted by the observing platform?

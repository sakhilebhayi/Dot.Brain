# Ecosystem Intelligence Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Dot.Memory, Dot.Brain and Dot.Dopemine one intelligence system running a continuous
loop — Observe → Remember → Understand → Decide → Act → Measure → Learn → Remember — with a single
versioned contract that any future Dot platform can join.

**Architecture:** Generalize the pattern already running in production (the Dot.Mines guardian:
incidents → decision engine → CI/CD → outcome → recall) into a domain-agnostic contract. Dot.Memory
owns evidence and outcomes; Dot.Brain owns reasoning and decisions; Dot.Dopemine executes
*engagement interventions* under its existing ethics gate. Non-engagement execution stays with the
platform that owns it.

**Tech Stack:** Laravel 12 / PHP 8.5 / PHPUnit (Memory, Dopemine); Node 22 ESM zero-dep (Brain);
JSON Schema for the contract.

## Global Constraints

- **Separation of responsibility is load-bearing (spec §9).** Memory must not reason or execute;
  Brain must not become the durable store; Dopemine must not decide or store knowledge.
- **Dopemine's ethics gate is never bypassed.** An intervention it executes must map to a certified
  mechanic; uncertified ⇒ refused, recorded, escalated.
- **Dot.Memory's "store without reading" boundary (its wiki §2)** still governs third-party tenant
  content. The loop's own records are first-party ecosystem knowledge (the carve-out recorded in
  wiki.md 0.7.0) and remain queryable by envelope, narrative encrypted at rest.
- Autonomy levels mirror the guardian's proven ladder: observe / recommend / approve / execute /
  autonomous-for-low-risk. High-risk always requires a human.
- Every loop record must be explainable end to end (spec §11): evidence → meaning → recommendation
  → action → outcome, each traceable by id.
- Tests: PHPUnit feature tests per endpoint; `node --test` for Brain. pint + bare phpstan/psalm must
  stay clean (mines-style discipline; Memory currently green).

---

### Task 1: The Intelligence Contract (Dot.Brain, source of truth)
Create `schemas/intelligence-loop.schema.json` defining the envelope every platform exchanges:
`loop_id`, `event_id`, `platform`, `tenant` (team/user context), `subject` (what the loop is about:
type + external id), `source`, `evidence_refs[]` (Memory record ids), `decision` {reasoning_ref,
recommendation, confidence 0..1, risk 0..1, autonomy_level, requires_approval}, `action`
{kind, executor_platform, mechanic_ref?, approval_status, execution_status}, `outcome`
{observed, measure, value, verdict}, `occurred_at`/`recorded_at`. Plus `adr/ADR-0015` recording the
three-platform division of responsibility and the Dopemine scope reconciliation.

### Task 2: Dot.Memory — observe & remember
Migration + model `LoopEvent` (envelope columns queryable; narrative in an encrypted `detail` blob).
`POST /api/intelligence/events` ingests an observation from any platform (idempotent on `event_id`).
Feature tests incl. auth, validation, idempotency.

### Task 3: Dot.Memory — serve historical context (the Brain's question)
`GET /api/intelligence/context?subject_type=&subject_id=&platform=` returns the evidence pack:
what happened (timeline), what was tried before (past decisions+actions), what worked (outcome
verdicts with a success rate), known gaps/conflicts. This is the "What do we know?" endpoint and the
generalization of the guardian's `/api/ops/recall`. Tests cover empty history, rich history, and the
success-rate maths.

### Task 4: Dot.Memory — record decisions, actions and outcomes
`POST /api/intelligence/decisions`, `POST /api/intelligence/actions`,
`POST /api/intelligence/outcomes` — each linked to the loop by `loop_id`, closing Observe→…→Learn.
Outcome recording updates the learned success rate the context endpoint serves. Tests prove a full
loop round-trip changes what context returns (i.e. the system demonstrably learns).

### Task 5: Dot.Brain — the reasoning client
`services/intelligence/` (zero-dep Node, mirroring services/guardian): `context.js` (fetch evidence
from Memory), `reason.js` (domain-agnostic decision: severity/confidence/risk → autonomy gate,
generalizing guardian `decide.js`), `emit.js` (post decision back to Memory, dispatch action to the
executor platform). Unit tests per rule branch.

### Task 6: Dot.Dopemine — the action layer
`POST /api/intelligence/actions` accepting an approved decision; validates the referenced mechanic is
**certified** (ethics gate), executes/records the intervention as a `MechanicDeployment`-linked
action, and reports the result back to Memory. Refuses uncertified mechanics with a recorded reason.
Tests cover certified accept, uncertified refusal, and result reporting.

### Task 7: Close the loop end to end
An integration test (and a documented worked example) driving Observe → Context → Decide → Act →
Outcome → Context-again, asserting the second context call reflects the learned outcome. Publish the
pattern in `brain.architecture.md` + each platform's wiki changelog.

---
title: Dot.Brain — Brand Experience (Brand Feeling Engine Doctrine)
version: 0.1.0
status: proposed
owners: [Chief Intelligence Architect, UX Agent]
reviewing-agent: Governance Agent
human-approver: owner
last-review: 2026-10-23
review-cadence: quarterly
---

# Brand Experience

Purpose: how a brand's intended feelings become checkable product-experience decisions across the Dot ecosystem. This document is the doctrine: what the Brand Experience Framework and the brand profiles are, what counts as evidence for them, who may change them, how they apply to a single repository, and what ranks above them. The decisions behind it are in [ADR-0021](adr/ADR-0021-brand-feeling-engine.md); the data is in [brand/](brand/README.md); the code is in [services/brand-engine](services/brand-engine/README.md). It is `proposed`: it becomes `active` only when the owner says so.

> **Related documents:** [adr/ADR-0021-brand-feeling-engine.md](adr/ADR-0021-brand-feeling-engine.md) — the decision record · [brain.design.md](brain.design.md) — calm-technology standards for Brain's own surfaces (this document is the ecosystem-level counterpart for products) · [brain.dopemine.md](brain.dopemine.md) §2–3 — engagement ethics the habit and retention principles inherit · [brain.governance.md](brain.governance.md) — decision rights and the ethics gate · [brain.experiments.md](brain.experiments.md) — the only route to a validated finding · [brain.autonomy.md](brain.autonomy.md) — strategic direction is Level 3 · [brain.dkp.md](brain.dkp.md) — the field vocabulary reused (not the signed-pack machinery) · [schemas/brand-profile.schema.json](schemas/brand-profile.schema.json) · [schemas/brand-principle.schema.json](schemas/brand-principle.schema.json).

---

## 1. What this is, and what it is not

It is a way to say, for any Dot product: which feelings the owner intends a user to have, at which moments, through which concrete behaviours of the interface, with what evidence, and under which non-negotiable rules. Then to check a repository against that statement and report the gaps.

It is not a claim that users feel anything. A feeling in a profile is **intended**. It is labelled `intended` and `measured: false` in the data, and the validator rejects a profile that says otherwise. It is not a shared look: the ecosystem profile carries shared principles only, and every platform keeps its own functional identity. It is not a source of design output: generating a layout or copy is done by a Claude session using the design skills; the engine supplies the target and, in later increments, the measurement.

## 2. Layers

```mermaid
flowchart TB
    F[Brand Experience Framework<br/>12 principles · brand/framework/principles] --> E[dot-ecosystem profile<br/>shared principles and non-negotiables only]
    E --> B[Brand profiles<br/>infodot · blupin · brand/profiles]
    B --> P[Product profile<br/>in the product's own repository]
    P --> R[Resolved profile<br/>origin recorded on every rule]
    R --> S[Claude session designs and builds<br/>using the design skills]
    S --> M[Measure and report<br/>later increments: BXQS, analysers]
    M --> PR[Proposed knowledge update<br/>a pull request the owner reviews]
```

*Caption: knowledge flows down by `extends`, design happens in the session, and anything learned comes back only as a proposed change to reviewed data.*

| Layer | Where it lives | Who changes it |
|---|---|---|
| Framework (12 principles) | `brand/framework/principles/` in Dot.Brain | Proposed by AI or human; ratified by the owner only |
| Ecosystem and brand profiles | `brand/profiles/` in Dot.Brain | Same |
| Product profile | `brand/profile.json` (or any path) in the product repository | The product's owner; visibility follows that repository |
| Assessment reports | The product repository | Produced there; their visibility follows that repository |

## 3. The framework

Twelve principles, each with a definition, intended outcome, applicable contexts, engineering-shaped implementation guidance, validation method, limitations, evidence, status, version and the rubric dimensions it will feed. The twelve topics are fixed by the owner's brief: emotional positioning; identity and professional confidence; differentiation; trust, transparency, privacy and reliability; perceived value versus usefulness; visual and interaction craftsmanship; ease of use and cognitive load; onboarding and time to first result; habit through continuing value; retention and advocacy; accessibility; cross-platform consistency. A principle's `validation_method` separates four kinds of check, because a score must never blur them: **automated** tests, **expert review**, **observed behaviour**, and **customer feedback**.

## 4. Evidence classes

| Class | Requires | What it may support |
|---|---|---|
| `documented_research` | `citation`, `citation_verified` | A reason to expect an effect. Unverified until a human checks the source |
| `observed_behaviour` | `n`, `method` | What was seen in real use; bounded by `n` |
| `internal_hypothesis` | `rationale` | A direction to test. Never a finding |
| `validated_finding` | `experiment_ref` ([brain.experiments.md](brain.experiments.md)) | The only class that supports a causal claim |
| `declared_intent` | `declared_by` | What the owner (or a repository policy) has chosen. Not evidence that anything works |

A class may not carry another class's fields. A confidence value may not exceed what its evidence supports. Today every principle rests on hypothesis, declared intent or an unverified citation, and no experiment registry runs, so no validated finding exists. Psychological assumptions are therefore never stated as established facts, and the guidance in a principle is a proposal to test, not a result.

## 5. Status, and who may change what

`draft` → `proposed` → `ratified` → `superseded`. An AI session may write a draft and propose it. **Only a human approver ratifies**, from `proposed`, and a ratified document must name its approver and the time. Strategic direction is Level 3 ([brain.autonomy.md](brain.autonomy.md)), so the engine, the Skill and any agent may *recommend* a profile, a principle or a change to one and may never ratify it, even on a standing instruction. Superseded versions are kept with provenance, never overwritten ([CLAUDE.md](CLAUDE.md), rule 1).

The honest limit: a JSON file can only say who approved it. The validator rejects the false claims it can detect (ratified with no approver, an AI as approver, an approver on a draft). What makes a ratification real is the owner reviewing and merging a pull request that touches `/brand/`, which `.github/CODEOWNERS` routes to the owner. Branch protection that requires that review is a repository setting, not something this document can create.

## 6. Applying it to one repository

The engine works on any repository by itself. A product repository keeps its own `brand/profile.json` with `extends: "<brand or ecosystem profile>@<version>"`. Resolution merges conservatively: prohibitions (banned phrases, prohibited visuals, the claims policy) only accumulate; a non-negotiable inherited rule cannot be overridden; replacing any other inherited value needs a written reason in `overrides[]`, and an override that replaces nothing is an error. Each resolved rule carries `origin`, so a design decision can be traced back to the profile that set it. The profile cites the product's own `PRODUCT.md`, `DESIGN.md` and token file by path and sha256. `drift` reports a cited file that changed or disappeared, so a stale profile announces itself. Tokens are never copied into a profile.

## 7. Precedence

Domain safety, regulation, accessibility, security and functional correctness always outrank brand rules. A mining fleet dashboard, a trading screen, a mentoring platform and a document editor need different hierarchies, trust mechanisms and emotional registers; none may bend a safety alert, a legal duty, a contrast ratio, a permission check or a computed figure to fit a brand. The engine records where a brand rule yields (`domain_overrides[]`: principle, what it yields to, reason). It never records a brand rule winning. Reassurance does not soften an alert; a distinctive colour yields to contrast; a faster first result does not skip identity or consent; a polished figure that is wrong is worse than no figure.

## 8. Engagement and Dopemine

The habit (BXP-09) and retention (BXP-10) principles define value as the outcome a user chose. App opens, session time, scroll depth, streak length and notification click-through are never targets ([brain.dopemine.md](brain.dopemine.md) §2); they may be guard metrics. Both principles carry the constraint in their data, and every engagement-related recommendation is flagged for human review and goes through the Dopamine gate ([brain.governance.md](brain.governance.md) §5). The engine calls nothing in Dot.Dopemine; the relationship is reference-only. Dot.Memory use is limited to assessment history (what was measured against which profile version), opt-in and written only from Actions; it is decided in a later increment, and until then nothing here talks to Memory.

## 9. Scope and visibility

Version 1 covers Dot-owned and first-party products. Customer-brand profiles need tenant isolation, authentication and storage, so they need a running service and a separate ADR. Dot.Brain is public: a profile stored here must be classification `public` and contain nothing private or personal, and product profiles are refused here and belong in their own repositories.

## 10. What exists and what does not

| Exists (this increment) | Not yet built |
|---|---|
| Schemas for profiles and principles | The Brand Experience Quality Score (BXQS): weights, evidence rules, versioning |
| `services/brand-engine`: validator, registry, `extends` resolution, drift check, CLI | Analysers that read a repository |
| The 12 principles (all `draft`) | The Claude Skill that retrieves a profile and runs the workflow |
| Profiles `dot-ecosystem`, `infodot`, `blupin` (all `draft`) | An Actions workflow |
| CODEOWNERS routing for `brand/` | Any call to Dot.Memory or Dot.Dopemine |
| Tests, including every shipped file validating | Customer-brand tenancy; demonstrations on example products |

No score, no assessment of any real product and no measured feeling exists. Anything that claims otherwise is wrong.

---

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1.0 | 2026-10-23 | Brand engine foundation (AI-drafted, owner to review) | Initial doctrine: layers, evidence classes, status rules, per-repo application, precedence, engagement constraint, scope, and an explicit list of what does not exist yet. |

## Open Questions

| Question | Owner → Approver |
|---|---|
| Does the owner want branch protection requiring a CODEOWNERS review on `/brand/`? Without it, ratification by merge is a convention, not a control | Chief Intelligence Architect → owner |
| BXQS: weights and the evidence each dimension needs, versioned so history stays comparable | UX Agent → owner |
| Which of InfoDot's conflicting design documents governs (`docs/infodot-ui-design-guide.md` versus `PRODUCT.md` and `DESIGN.md`)? The `infodot` profile records the conflict and decides neither | UX Agent → owner |
| Should Blupin share the ecosystem principles? No product or audience has been identified, so its profile extends nothing | Chief Intelligence Architect → owner |
| Verify the three recorded citations (WCAG 2.2, Nielsen's usability heuristics, Sweller 1988) or remove them | Knowledge Agent → Chief Knowledge Engineer |

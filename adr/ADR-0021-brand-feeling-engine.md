---
title: ADR-0021 — Brand Feeling Engine Inside Dot.Brain: Targets and Measures, Recommends and Never Ratifies
version: 1.1.0
status: active
owners: [Chief Architect]
last-review: 2026-10-23
---

# ADR-0021 — Brand Feeling Engine Inside Dot.Brain: Targets and Measures, Recommends and Never Ratifies

Purpose: record where the Brand Feeling Engine lives, how it applies to any repository, what counts as evidence for its knowledge, what it does not do (no LLM, no ratification, no customer brands), and the precedence rule that keeps brand below safety, regulation, accessibility, security and correctness.

> **Related documents:** [../brain.brand_experience.md](../brain.brand_experience.md) — the doctrine this decision supports · [../brain.design.md](../brain.design.md) — calm-technology standards for Brain's own surfaces · [../brain.dopemine.md](../brain.dopemine.md) §2–3 — the engagement ethics the habit and retention principles inherit · [../brain.autonomy.md](../brain.autonomy.md) — strategic direction is Level 3 · [../brain.experiments.md](../brain.experiments.md) — what a validated finding requires · [ADR-0020-infodot-knowledge-candidates.md](ADR-0020-infodot-knowledge-candidates.md) — the precedent for a rules-only service that recommends · [../docs/superpowers/specs/2026-10-23-brand-engine-foundation-design.md](../docs/superpowers/specs/2026-10-23-brand-engine-foundation-design.md) — the design · [../services/brand-engine](../services/brand-engine/README.md) — implementation.

---

## Status

Accepted — 2026-10-23 (the decisions; the data under `brand/` is all `draft`)

## Context

The owner asked for a "Brand Feeling Engine": a capability that turns a brand's intended feelings into measurable product-experience decisions for Blupin, InfoDot and the Dot ecosystem, usable on any repository. Reading the repository first showed what it can and cannot be:

- Dot.Brain is not a running application. `brain.api.md` is a specification; there is no HTTP server. Its services are zero-dependency Node packages run from the owner's machine or from GitHub Actions.
- DKP (`schemas/knowledge-pack.schema.json`, `brain.dkp.md`) is a specification. No signer, ingester or validator exists, so no profile or principle can honestly be called a signed pack.
- In practice approval is the owner merging a pull request. `brain.autonomy.md` classes "strategic direction" as Level 3 (owner only), and a brand is strategic direction.
- Dot.Brain is public. Anything stored in it is public, and the manifesto (rule 4) says Brain never edits platform-owned files.
- The honesty rules already in force (`brain.autonomy.md`: an unmeasured thing is reported as zero, never hidden; `brain.dopemine.md`: engagement is never a target) apply to this capability like any other.

## Decision

1. **Placement.** One service, `services/brand-engine/` (zero-dependency Node 22.5 or later, library plus CLI, tests with `node --test`), and one top-level data directory, `brand/` (`brand/framework/principles/*.json`, `brand/profiles/<id>.profile.json`, later `brand/rubrics/`). Two schemas, `schemas/brand-profile.schema.json` and `schemas/brand-principle.schema.json`. Knowledge data is kept apart from code and reviewed by path: `.github/CODEOWNERS` names the owner for `/brand/`, the two schemas and the rule file that defines what "ratified" must look like. This is not a separate application, not a Claude Skill with its own copy of the knowledge, and not a collection of documents outside the repo's conventions.
2. **Per-repo application.** The engine applies to any repository individually. The framework, the rubric and the brand-level profiles (`dot-ecosystem`, `infodot`, `blupin`) live in Dot.Brain. A product repository keeps its own product profile (for example `brand/profile.json`), which `extends` a Brain profile by `id@version`, and keeps its own assessment reports, so a report's visibility follows the product repository's. The registry resolves `extends` from Brain's profiles and loads a product profile from an arbitrary path. A profile cites its repository's `PRODUCT.md` and `DESIGN.md` by pointer and sha256 (`visual_direction.source_refs`) and never copies tokens. A drift check reports a cited file that changed or disappeared. No product-level profile is stored in Brain; one example exists as a test fixture.
3. **Evidence classes.** Every assertion in the knowledge carries one of five classes, and the validator enforces what each requires: `documented_research` (a citation and a `citation_verified` flag), `observed_behaviour` (a sample size `n` and a method), `internal_hypothesis` (a rationale), `validated_finding` (an experiment reference per `brain.experiments.md`) and `declared_intent` (who declared it; an owner's strategic choice, not evidence that anything has an effect). A class may not carry another class's fields, and a confidence value may not exceed what the evidence classes support (hypothesis or intent alone: 0.5 for a principle; an unverified citation: 0.6; a verified one: 0.8; observed: 0.85). Every principle launches as `internal_hypothesis` or `declared_intent`, or `documented_research` with `citation_verified: false`, and the citations used are well-known standards or papers cited by title only, to be verified by a human later. No experiment registry runs yet, so no `validated_finding` can exist yet.
4. **No LLM in Brain.** The engine decides targets and measures. It is rules, schemas and hashes, in the style of `services/intelligence/src/reason.js` and ADR-0020. Generative design (turning a target into a layout or copy) happens in the Claude session, using the installed design skills; the engine hands that session a resolved profile and later records what was measured. A model inside the engine would be unreproducible and unexplainable.
5. **Recommend, never ratify.** A profile or principle has a status: `draft`, `proposed`, `ratified` or `superseded`. An AI session may create `draft` and move it to `proposed`; only a human approver can ratify. The validator rejects `ratified` without an `approver` and a `ratified_at`, rejects an approver who is an AI contributor, and rejects an approver or `ratified_at` on a draft or proposed document (a false claim of ratification). The transition function allows ratification only from `proposed`, only by a human. Nothing in this change is ratified. A limit that must be stated: a file can only say what it claims. The control that actually makes ratification real is the owner's review and merge of a pull request on a CODEOWNERS-protected path. The validator makes the detectable false claims impossible to merge by accident; it cannot prove who typed a name.
6. **Tenant scope, version 1.** Dot-owned and first-party products only. Customer-brand profiles need tenant isolation, authentication and storage that a CLI run from Actions does not provide; they need a running service and a separate ADR. Nothing about a customer's brand is stored in Dot.Brain.
7. **Memory and Dopemine.** Dot.Memory use is limited to assessment history (what was measured, when, against which profile version), opt-in, written only from Actions, and is decided in a later increment; this change makes no call to Memory. Dot.Dopemine is reference-only: the habit and retention principles state the Dopemine ethics constraint and flag engagement-related recommendations for human review, but the engine calls nothing in Dopemine.
8. **Precedence.** Domain safety, regulation, accessibility, security and functional correctness always outrank brand rules. A profile records the cases where a brand rule yields in `domain_overrides[]` (principle, what it yields to, reason). The engine records overrides; a brand rule can never win. The ecosystem profile makes this a non-negotiable behavioural principle that every profile inherits and none can override.
9. **"DKP-compatible" means vocabulary, not packs.** Profiles and principles use DKP's field names (`contributors`, `provenance` with `sources`, `transformations` and `published_by`, `confidence` 0 to 1, semver, classification levels). They are not Knowledge Packs, are not signed, and the docs never say otherwise. If a pack pipeline is built, wrapping them is mechanical.
10. **Validation is the schema file itself.** The repository has no schema-validator dependency. The service interprets the two schema files with a small validator that supports only the keywords the schemas use and throws on any other, so a schema edit can never silently stop being enforced. Cross-field rules JSON Schema cannot express (evidence-class requirements, status and approver, `extends` and override rules) are separate pure functions. A test confirms the enums in code equal the schemas' enums.

## Consequences

- A developer or a Claude session can run `profile resolve` against a product profile and get the inherited non-negotiables, the prohibitions, the claims policy and a traceable origin for every rule, offline, with no secret.
- Rules inherited as non-negotiable cannot be overridden even with a reason; replacing any other inherited value needs a written reason, and an override that replaces nothing is an error. Prohibitions only accumulate down a chain.
- A profile that extends a `draft` parent is reported as `draft` in `effective_status`, however the child is labelled.
- Public visibility is enforced: a profile stored in Brain must be classification `public`, and a product profile is refused there.
- The owner is the bottleneck for ratification by design. Until the owner ratifies, every profile and principle is a draft, and downstream increments must treat them as such.
- Later increments (the BXQS rubric and scoring, analysers, the Claude Skill, an Actions workflow, a Memory assessment history) build on this foundation and each carries its own review.

## Alternatives considered

- **A standalone application or a service with an HTTP API.** Rejected: Dot.Brain has no running app, and a second deployment surface for a data set this size adds risk without a user.
- **A Claude Skill as the source of truth.** Rejected: the Skill would copy knowledge that must be versioned, reviewed and diffed in one place. The Skill (a later increment) is an interface that retrieves from Brain.
- **An LLM to judge brand fit.** Rejected for the reasons in decision 4.
- **Storing customer brand profiles in Brain.** Rejected for v1: Brain is public and has no tenant isolation (decision 6).
- **Calling the profiles DKP packs.** Rejected: nothing signs or ingests them, and the claim would be false.
- **Letting an AI session ratify under owner standing instruction.** Rejected: ratification is strategic direction (Level 3), and a standing instruction is not a per-profile decision.
- **A JSON Schema library.** Rejected: every service here is zero-dependency, and the keyword subset needed is small enough to test completely.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-23 | Brand engine foundation (AI-drafted, owner to review) | Initial decision record. |
| 1.1.0 | 2026-10-23 | Brand engine scoring (AI-drafted, owner to review) | Open question on the BXQS closed by ADR-0022; no decision above changed. |

## Open questions

- **Ratification is by merge.** The validator checks the form of a ratification claim. Whether branch protection requires a CODEOWNERS review on `/brand/` is a repository setting the owner must confirm; this ADR cannot set it.
- **The Brand Experience Quality Score (BXQS).** Decided in [ADR-0022](ADR-0022-bxqs-scoring-policy.md): the rubric `bxqs-1.0.0` and the scoring engine exist, the rubric is proposed and not ratified, and no real product has been scored. No score of a real product may be quoted until evidence has been produced for it.
- **Which InfoDot document governs.** `docs/infodot-ui-design-guide.md` ("control center") conflicts with InfoDot's `PRODUCT.md` and `DESIGN.md` ("The Yard", not a control room). The `infodot` profile cites both and decides neither.
- **Blupin.** No shipping product or audience has been identified. The profile is deliberately minimal and its relationship to the ecosystem profile is undecided.
- **Citation verification.** Three citations are recorded with `citation_verified: false`. A human verifies them or removes them.
- **Memory assessment history.** Contract, tenancy and retention are undefined until the increment that needs them.

# Brand Feeling Engine: Foundation (Increments 0 to 3)

## Context

The owner asked for a Brand Feeling Engine inside Dot.Brain: intended brand feelings for Blupin, InfoDot and the Dot ecosystem, turned into engineering decisions and measured against real repositories. The full brief has ten parts (framework, profiles, analysis, design, validation, a 100-point quality score, a Claude Skill, governance, integrations, demonstrations). This design covers only the first four increments, the foundation everything else stands on. What the repository is determined what could honestly be built:

- Dot.Brain has no running app. Services are zero-dependency Node packages (`services/*`, `node --test`) run from the owner's machine or GitHub Actions. `brain.api.md` is a specification.
- DKP is specification only: no signer, ingester or validator. Approval is the owner merging a PR. `brain.autonomy.md` classes strategic direction as Level 3.
- The repository is public.

Decision record: [ADR-0021](../../../adr/ADR-0021-brand-feeling-engine.md). Doctrine: [brain.brand_experience.md](../../../brain.brand_experience.md).

## Goal

1. A decision record and doctrine (increment 0).
2. Two schemas, a registry that loads and validates the data and resolves `extends`, and a CLI (increment 1).
3. The twelve framework principles as data (increment 2).
4. Draft profiles for `dot-ecosystem`, `infodot` and `blupin` (increment 3).
5. Tests for all of it, and the service in the CI matrix.

## Non-goals

- The Brand Experience Quality Score (BXQS), its weights and its versioning. Principles name the rubric dimensions they will feed; nothing scores yet.
- Analysers that read a repository, the experience design and implementation workflow, the Claude Skill, an Actions workflow.
- Any call to Dot.Memory or Dot.Dopemine.
- Product-level profiles in Brain, customer-brand profiles, any ratified document.
- Demonstrations on example products and the implementation report.

## Layout

```
brand/
  framework/principles/BXP-NN-<slug>.json     12 principles
  profiles/<id>.profile.json                  dot-ecosystem, infodot, blupin
schemas/brand-profile.schema.json
schemas/brand-principle.schema.json
services/brand-engine/
  src/schema.js      small JSON Schema interpreter (fails closed on unsupported keywords)
  src/rules.js       cross-field rules: evidence classes, confidence caps, status/approver, transitions
  src/registry.js    load brand/, validate, cross-check, load a product profile from any path
  src/resolve.js     extends resolution, override enforcement, origin tracking
  src/drift.js       sha256 check of cited files against a checkout
  src/main.js, cli.js
  test/              node --test, plus a fixture product checkout
.github/CODEOWNERS   /brand/, the two schemas and src/rules.js
```

## Data model

**Principle** (`BXP-01` to `BXP-12`): id, slug, title, version, status, contributors, definition, intended_outcome, applicable_contexts, implementation_guidance (concrete, engineering-shaped), validation_method (automated, expert_review, observed_behaviour, customer_feedback), limitations, evidence, rubric_dimensions (names from the brief's twelve BXQS dimensions), engagement_related with `dopemine_constraint` and `requires_human_review` where true, provenance, confidence.

**Profile**: id, kind (`ecosystem|brand|product`), extends (`id@semver`), version, status, supersedes, classification, contributors, approver, ratified_at, purpose, audience[] (with `identified` and evidence), positioning, emotional_promise[] (each `label: intended`, `measured: false`), behavioural_principles[] (with `non_negotiable`), visual_direction (source_refs[repo, path, commit, sha256, role], constraints, prohibited), language (voice, banned_phrases, claims_policy), experience_standards[] (principle bindings with a pinned principle version), domain_overrides[], overrides[] (reasons for replacing inherited values), unknowns[] (required, non-empty for a draft), provenance, confidence.

Both reuse DKP's vocabulary (contributors, provenance sources and transformations, confidence 0 to 1, semver, classification levels). They are not Knowledge Packs and are not signed.

**Evidence** on every assertion, one of five classes, each with required and forbidden fields (see the ADR). A confidence value is capped by the weakest honest reading of its evidence.

## Validation

The schemas are the single source of truth for shape. `schema.js` interprets the schema files directly and supports only the keywords they use (`type`, `enum`, `const`, `pattern`, length and bounds, `items`, `properties`, `required`, `additionalProperties`, `patternProperties`, `$ref` into `$defs`, `uniqueItems`, `format: date-time`); any other keyword or format throws when the schema is compiled. Alternative considered: a hand-written validator plus tests that fixtures validate identically. Rejected because it leaves two definitions to drift.

`rules.js` holds what a schema cannot say: evidence-class requirements, confidence caps, status and approver rules, the transition table, relative-path safety for cited files, uniqueness, and the Brain-versus-product location rules (Brain accepts only `public` classification and never a `product` profile; a profile loaded from a product checkout must be `product` and must `extends` something).

## Resolution

Chain: `extends` is `id@version`, resolved exactly against Brain's profiles; the parent version must match. Cycles are detected first, then kinds (`product` may extend `brand` or `ecosystem`, `brand` may extend `ecosystem`, `ecosystem` extends nothing), depth is bounded at 8.

Merge, root first. Child keeps its own identity parts (purpose, audience, positioning, emotional promise, unknowns). Inherited and merged, each item tagged with `origin`:

| Field | Rule |
|---|---|
| banned phrases, prohibited visuals, constraints, `evidence_required` | union; a child can add and never remove |
| claims policy `forbidden` | union by id; redefining an inherited id is an error |
| behavioural principles | by id; a non-negotiable one cannot be changed; changing another needs an override |
| experience standards | by principle; expressions accumulate; a stance change needs an override; a non-negotiable standard must keep stance `applies` or `emphasised` |
| cited sources | by `repo/path`; a different hash or commit needs an override |
| voice | child may replace with an override |
| domain overrides | union |

An override is `{field, reason}` with a reason of at least 20 characters. An override that replaces nothing is an error. `effective_status` is the lowest status in the chain (a `proposed` child of a `draft` parent is `draft`); a superseded profile in the chain is a warning.

## CLI

```
profile list | show <id|file> | validate [<id|file>] | resolve <id|file>
framework list | show <BXP-NN>
drift <id|file> --root <checkout> [--repo <owner/name>]
```

`--brand-dir` overrides the default `brand/`. A path ending `.json` (or containing a separator) is a product profile; anything else is a registry id (`id` or `id@version`). Exit 0 ok, 1 findings (invalid data, unresolvable profile, drift), 2 usage. Output is deterministic (sorted keys, no timestamps), the CLI reads no environment variable and writes nothing, and invalid brand data makes every read command exit 1 (fail closed).

`drift` checks the profile's own `source_refs` (inherited ones belong to the parent's repository) against `--root`: `OK`, `CHANGED` (both hashes printed), `MISSING`, or `UNREADABLE` (not a file, unsafe path, a symlink leaving the checkout, over 10 MB). Refs in more than one repository require `--repo`.

## The three profiles

All `draft`, authored by an AI session, contributors `claude-sonnet-5-5`, no approver.

- **dot-ecosystem** (kind ecosystem): shared principles and non-negotiables only (honest states, accessibility, error recovery, naming, no dark patterns, token interoperability, each platform's own functional identity, brand yields to domain). No shared visual identity. Binds all twelve principles; five are non-negotiable.
- **infodot** (kind brand, extends dot-ecosystem@0.1.0): the brief's five feelings plus "respected and equipped", the product's own purpose, audience and principles, pointers and hashes to InfoDot's `PRODUCT.md`, `DESIGN.md` and `resources/css/infodot.css` (no tokens copied), and the conflicting `docs/infodot-ui-design-guide.md` cited with role `conflicting_guidance` and recorded as an unresolved unknown. Claims policy forbids invented counts, testimonials and compliance claims.
- **blupin** (kind brand, extends nothing): BluPin Incorporated, the holding company. Audience `unknown`, positioning "not established", no visual direction, a claims policy forbidding performance, return, authorisation, entity and unsupported-figure claims, and unknowns recording that no shipping product with an audience has been identified. The brief's "performance" is read as an experience quality and the owner is asked to confirm.

The example product profile is a test fixture (`test/fixtures/example-product`), marked `x-fixture`, with its own `PRODUCT.md` and `DESIGN.md` cited by hash.

## Testing

`node --test`: schema interpreter accept and reject tables; evidence-class rules, confidence caps; status and approver rules and the transition table (an AI cannot ratify); `extends`, cycles, kind order, override enforcement, non-negotiables; the fixture product from an arbitrary path and from temp checkouts; drift (changed, missing, unreadable, symlink escape, path traversal, multi-repository); the CLI as a subprocess (exit codes, determinism, no environment value in any output, read-only); every shipped file validating; exactly twelve principles with all required fields; every BXQS dimension fed; no `ratified` status; unknowns present; the Blupin claims policy; no private material in `brand/`; the CI matrix and `covered=` list.

## Rollout

Merging adds a service and data; nothing runs automatically. The owner reviews `brand/` (CODEOWNERS), decides the open questions below, and may ratify a profile by changing its status and adding `approver` and `ratified_at` in a reviewed PR.

## Open questions

- BXQS weights, evidence rules and versioning (next increment).
- Which InfoDot design document governs.
- Whether Blupin should share the ecosystem principles, and which products it will cover.
- Whether a repository setting enforces CODEOWNERS review on `/brand/`.
- Verification of the three recorded citations.

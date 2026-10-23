# Dot.Brain — Brand Engine

The registry, checker and scoring engine behind the Brand Feeling Engine (ADRs:
[ADR-0021](../../adr/ADR-0021-brand-feeling-engine.md) foundation, [ADR-0022](../../adr/ADR-0022-bxqs-scoring-policy.md) scoring; doctrine:
[brain.brand_experience.md](../../brain.brand_experience.md); design:
[spec](../../docs/superpowers/specs/2026-10-23-brand-engine-foundation-design.md)).

It loads the reviewed data in [`brand/`](../../brand/README.md), validates it, resolves a profile's
`extends` chain, and checks that the files a profile cites have not drifted. It is **read-only,
offline, and has no LLM**. It decides nothing about a brand and ratifies nothing. Since 0.2.0 it also
**scores**: given an evidence file it computes the Brand Experience Quality Score (BXQS) report described
below. It measures nothing itself: the analysers that produce the evidence file, the Claude Skill and any
Actions workflow are later increments.

## Run

```
node src/cli.js profile list
node src/cli.js profile show <id|file>
node src/cli.js profile validate [<id|file>]
node src/cli.js profile resolve <id|file>
node src/cli.js framework list
node src/cli.js framework show BXP-09
node src/cli.js drift <id|file> --root <checkout> [--repo <owner/name>]
node src/cli.js score --evidence <file> --profile <id|file> [--rubric bxqs-1.0.0] [--built-by <id>]
node src/cli.js compare <baseline-report.json> <candidate-report.json>
node src/cli.js rubric show|validate [bxqs-1.0.0]
```

`<id>` is a Dot.Brain profile (`infodot` or `infodot@0.1.0`). A value ending `.json`, or containing a
path separator, is a **product profile** loaded from that path: a product repository's own
`brand/profile.json`, which `extends` a Brain profile and is never added to the registry.
`--brand-dir <dir>` points at a different `brand/` directory.

| Exit | Meaning |
|---|---|
| `0` | ok |
| `1` | findings: invalid data, an unknown or unresolvable profile, or drift. Invalid brand data fails every read command closed |
| `2` | usage error |

`score`, `compare` and `rubric` use their own codes: `0` report or comparison produced, `2` invalid input
(usage, evidence file, unknown profile, `--built-by` that contradicts the file), `3` refused (a rubric that
was modified since release or is not released, invalid brand data, a comparison across a major rubric
version). Their output is a JSON document on stdout; the reasons are on stderr.

Output is deterministic: sorted keys, no timestamps, and the CLI reads no environment variable, so
no secret can reach it.

## Using it from a product repository

1. Write `brand/profile.json` in the product repository: `kind: "product"`, `extends: "infodot@0.1.0"`
   (or another brand or ecosystem profile), your own purpose, audience, positioning and intended feelings,
   and `visual_direction.source_refs` pointing at your own `PRODUCT.md` / `DESIGN.md` / token file with
   `repo`, `path`, `commit` and `sha256`. Do not copy tokens. See the fixture
   [`test/fixtures/example-product`](test/fixtures/example-product/brand/profile.json).
2. `node <brain>/services/brand-engine/src/cli.js profile validate brand/profile.json --brand-dir <brain>/brand`
3. `... profile resolve brand/profile.json` for the inherited non-negotiables, prohibitions, claims policy
   and the origin of every rule.
4. `... drift brand/profile.json --root .` in CI or before a design session: a cited file that changed or
   vanished is reported and the exit code is non-zero. Only the profile's **own** `source_refs` are checked;
   inherited ones belong to the parent's repository. Profile refs in more than one repository need `--repo`.

## Scoring (BXQS)

`score` turns an evidence file into a report. It is **pure and deterministic**: no clock (the report's
`generated_at` is the evidence file's), no environment, no network, no model; the same input gives a
byte-identical report. It is **advisory**: nothing runs it automatically and nothing is blocked by it.
Policy: [ADR-0022](../../adr/ADR-0022-bxqs-scoring-policy.md). Rubric, its immutability and semver policy:
[`brand/rubrics/`](../../brand/rubrics/README.md).

### The three numbers

| Number | Meaning |
|---|---|
| **Evidenced score** | Points actually earned, out of 100. A check or metric nobody measured counts as zero and is listed in the report; it is never excluded and never estimated. |
| **Ceiling** | Sum over dimensions of weight x cap (the most automated and expert evidence can earn), or the full weight where observed or customer evidence is present. 62.2 with automated and expert evidence only. |
| **Attainment** | Evidenced divided by ceiling, as a percentage. How much of what the evidence could earn it did earn. |

All three are truncated, never rounded up.

### Why 90 is unreachable on automated and expert evidence alone

The ten measurable dimensions cap at 62.2 points between them. A perfect automated run plus a human expert at
the top level earns 62.2: full attainment and `build_verified`, but not release. With only an AI as expert it
earns about 49.8 (80.1 percent attainment, `not_ready`). The remaining 37.8 points are reserved for observed
behaviour and customer feedback, because no tool can show that people could use the product, trusted it or got
what they came for. Dimensions 11 and 12 (10 points) need people who have come back. To reach 90 honestly,
at least 27.8 of the 37.8 must be earned from real results. A small observed or customer pilot (at least five
participants per result) is what unlocks it.

### Rules

- **Dimension arithmetic.** The rubric splits each dimension's weight into an automated share, an expert share and an observed-or-customer share (cap = automated + expert = 1 - observed-or-customer). Points = weight x share x the weighted result of that source.
- **AI-only expert assessment counts at most 50%.** The assessor kind (`human` or `ai`) is declared in the evidence and recorded in the report. Beside a human assessment an AI assessment is `corroborating`: it can reveal disagreement and carries no points.
- **The builder is never the sole assessor.** `built_by` (the evidence field, or `--built-by`) names who built the change. That assessor's own assessment is recorded and never earns points; if it is the only assessment of a dimension the expert component of that dimension is empty and the report says so. Without `built_by`, independence cannot be verified, which stops `release_ready`.
- **Dimensions 11 and 12** are `not_measured` unless real observed or customer results are supplied. A metric on the prohibited engagement list (`session_time`, `app_opens`, `scroll_depth`, `notification_click_through`, `streak_length`, `variable_reward_effectiveness`, `time_to_return`, and aliases) is rejected with a finding, flagged for human review, and never scored. A metric the rubric does not define is invalid input.
- **Minimum sample.** An observed or customer result with fewer than five participants is rejected.
- **Confidence.** High: two or more source classes, including observed or customer evidence, on at least 50 points of weight. Medium: automated and expert evidence together on at least 50 points of weight. Low: anything less. A disagreement of more than one level (between the automated result mapped to 0-4 and an assessor, or between assessors) makes the band Low.
- **Blockers.** `wcag_failure` at level A or AA, `unsupported_claim`, `failing_test`, `domain_override_violation`, and an unresolved `ethics_gate_flag`. A blocker means `not_ready`, and caps the affected dimension at half its weight.
- **Precedence.** Dimensions are scored independently, so nothing a brand rule earns offsets a dimension a safety, security or accessibility finding lowered. The profile's `domain_overrides` are copied into the report.
- **States.** `build_verified`: attainment at least 90 percent, no blockers, every dimension at or above its floor. `release_ready`: evidenced score at least 90, no blockers, every `build_verified` condition, observed or customer evidence on dimensions 3, 6 and 7 (and 8 if `assistive_technology_testing_possible`), confidence Medium or better, `built_by` declared, and a **ratified profile and a ratified rubric**. A draft, proposed or superseded profile or rubric caps the state at `build_verified`; `release_ready_unmet` lists exactly what is missing.
- **No invented text.** Every sentence the engine writes is a fixed template (`src/score/text.js`); all other strings are ids or text that came in as input. A test proves it, and that no template says a user feels anything.

### The evidence file

JSON, [`schemas/brand-evidence.schema.json`](../../schemas/brand-evidence.schema.json). The analysers (a later
increment) produce it; until then a person or a test writes it. Check ids and metric ids are those in the rubric
(`node src/cli.js rubric show`): they are the contract.

```json
{
  "evidence_version": "1.0.0",
  "generated_at": "2026-10-23T12:00:00Z",
  "input": { "repo": "owner/name", "commit": "<40 hex>", "scope": "optional" },
  "built_by": "id of whoever built the change",
  "context": { "assistive_technology_testing_possible": false },
  "assessors": [{ "id": "reviewer-1", "kind": "human" }],
  "automated": [{ "check_id": "d3.nav_depth", "value": 1, "detail": "optional", "artifact_ref": "path-or-url" }],
  "expert": [{ "dimension": "usability_cognitive_load", "assessor": "reviewer-1", "level": 3, "rationale": "...", "artifact_ref": "..." }],
  "observed": [{ "dimension": "usability_cognitive_load", "source_class": "observed_behaviour", "metric_id": "task_completion_rate", "value": 0.8, "n": 8, "method": "...", "artifact_ref": "..." }],
  "findings": [{ "id": "f1", "kind": "wcag_failure", "level": "AA", "criterion": "1.4.3", "detail": "...", "artifact_ref": "..." }]
}
```

`value` is 0 to 1, higher is better, normalised by the producer. `x-` fields are ignored. A file that contains a
credential-shaped string is refused. Nothing in the file is read from the environment or the clock.

### The report

[`schemas/brand-score.schema.json`](../../schemas/brand-score.schema.json). Header (rubric version and sha256,
engine version, profile id/version/hash, input commit, `generated_at`, assessors); the three headline numbers; `state`
with `state_reasons` and `release_ready_unmet`; `confidence` (band, reasons, disagreements, coverage); twelve
dimensions each with `status` (`scored`, `partially_evidenced`, `not_measured`), `points_earned`,
`points_possible`, `cap_applied`, an optional `finding_cap`, per-source components and every evidence entry
(`counted`, `corroborating`, `recorded_not_counted`, `rejected`, `not_measured`); `blockers`; `rejected_evidence`;
`missing_evidence`; `domain_overrides`.

### compare and versioning

`compare` takes a baseline and a candidate report. It shows per-dimension deltas and which evidence changed, and it
never re-bases a number. Same rubric: compared. PATCH (wording): compared. MINOR (checks or metrics changed):
compared with an annotation that part of the difference is methodology. MAJOR (dimension set, weights or caps):
**refused**, unless both reports are for the same repository and commit, and then labelled a comparison of
methodologies. A different rubric id, or the same version with a different hash, is refused. Semver policy:
[`brand/rubrics/README.md`](../../brand/rubrics/README.md).

## What it enforces

- **Shape**: the two schemas in `schemas/`, interpreted directly from the files. A schema keyword the
  interpreter does not implement throws when the schema is compiled.
- **Evidence** (`src/rules.js`): five classes, each with required and forbidden fields; a confidence
  value may not exceed what its evidence supports; `validated_finding` needs an experiment reference;
  `documented_research` needs a citation and `citation_verified`.
- **Status**: `ratified` needs a human `approver` and `ratified_at`; an AI contributor can never be the
  approver; a `draft` or `proposed` document may not carry either; ratification only from `proposed`.
  This checks the *form* of a claim. What makes it real is the owner's review of the pull request.
- **Honesty**: every draft lists `unknowns`; every emotional-promise item is `intended` and
  `measured: false`; an identified audience needs evidence; a claims policy is required.
- **Visibility**: a profile stored in Brain must be classification `public`, and a `product` profile
  is refused there.
- **Inheritance** (`src/resolve.js`): prohibitions only accumulate; a non-negotiable cannot be
  overridden; replacing an inherited value needs a written reason in `overrides[]`; an override that
  replaces nothing is an error; cycles, wrong kinds and version mismatches are errors; `effective_status`
  is the lowest status in the chain.
- **Cited files** (`src/drift.js`): paths are relative with no `..`, no absolute paths, nothing in `.git`;
  a symlink that leaves the checkout is refused; a file over 10 MB is unreadable.

## What it does not do

- Measure anything. `score` counts the evidence it is given; it has no analysers. No real product has been scored, and the only scores in this repository are test fixtures marked as such.
- Ratify a rubric. A rubric is ratified by the owner adding a record that names the hash, in a reviewed merge.
- Call an LLM, Dot.Memory or Dot.Dopemine, or any network.
- Ratify or sign anything. Profiles are not DKP packs: they reuse DKP's field names and nothing else.
- Verify the recorded `commit` of a cited file (it reads a directory, not git history); the hash is the check.
- Prove who approved a ratified document. CODEOWNERS and the owner's merge do that.

## Tests

`npm test` (zero dependencies, Node >= 22.5). Covers the schema interpreter, every rule and its
boundaries, extends resolution (cycles, overrides, non-negotiables, effective status), the example
product loaded from an arbitrary path and from temporary checkouts, drift (changed, missing, unreadable,
symlink escape, traversal), the CLI as a subprocess (exit codes, determinism, no environment value in
any output, read-only), and that everything shipped in `brand/` validates and stays honest (twelve
principles, none ratified, unknowns present, the Blupin claims policy, nothing private).

The scoring tests (`test/score.*.test.js`) cover: the rubric (weights sum to exactly 100, the owner's caps, shares,
the pinned hash, every way a rubric can be wrong, release and ratification records); the arithmetic on
hand-computed fixtures with each calculation written next to the expected number; the AI 50% rule, the builder
rule, minimum sample and cap boundaries; dimensions 11 and 12 and the prohibited-metric rejection; the confidence
table with its 50 and 49 point boundaries; blockers and precedence; the state machine at exactly 90 and just below,
at exactly the floor and just below, and the ratification requirement; compare across patch, minor and major;
frozen golden reports for seven synthetic scenarios; determinism and purity; and that every engine-written sentence
is a template.

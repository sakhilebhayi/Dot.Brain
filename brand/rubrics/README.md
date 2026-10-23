# brand/rubrics/

The Brand Experience Quality Score (BXQS) rubric, as data. Decisions: [ADR-0022](../../adr/ADR-0022-bxqs-scoring-policy.md). Doctrine: [brain.brand_experience.md](../../brain.brand_experience.md) section 10. Engine: [services/brand-engine](../../services/brand-engine/README.md) (`src/score/`). Schema: [schemas/brand-rubric.schema.json](../../schemas/brand-rubric.schema.json).

```
bxqs-1.0.0.json                  the rubric: 12 dimensions, 100 points, checks, expert anchors, metrics, caps, floors
released.json                    the ledger of released rubrics and the canonical sha256 of each
bxqs-1.0.0.ratification.json     (absent until the owner ratifies) the owner's ratification, naming the hash it ratified
```

## A released rubric is immutable

`released.json` records the canonical sha256 of every released rubric (the hash of its sorted-key, compact JSON, so formatting cannot change it). Every report records the same hash as `rubric_sha256`. The engine **refuses** (exit 3) to score with a rubric whose hash differs from the ledger, and a test pins the hash of `bxqs-1.0.0` a second time, in code, so changing the file means changing three things on purpose. To change a rubric you publish a **new version**; you never edit a released one.

The rubric file carries no `status`. Ratification is a separate record, `<id>-<version>.ratification.json`, that names the rubric hash it ratifies, so the owner can ratify without editing (and so re-hashing) the rubric. Without that record the rubric is `proposed` and no report can reach `release_ready`. A record that names a different hash, or whose approver is not a human, is refused.

## Semantic versioning

| Change | Version | What it means for scores |
|---|---|---|
| The dimension set, a weight or a cap | **MAJOR** | Scores are not comparable. `compare` refuses across a major version unless both reports are for the same repository and commit (the same input scored twice), and then says it is comparing methodologies, not progress. |
| A check or observed metric added, removed or re-defined; a floor or a policy number changed | **MINOR** | Comparable, annotated: part of any difference is methodology, not the product. |
| Wording only (descriptions, anchors, `measures` text) | **PATCH** | Scores are unaffected. |

Nothing is ever re-based: `compare` shows each report's numbers exactly as recorded. A patch still changes the hash, so it is a new file and a new ledger entry.

## How a dimension is scored

Each dimension has a weight `w` and three **shares** that sum to 1: automated `a`, expert `x`, and observed-or-customer `o`. `cap_without_observed_or_customer = a + x = 1 - o`: without people actually using the product, a dimension can earn at most `w x cap`, and the rest is reserved for observed or customer evidence.

- automated points = `w x a x` (sum of check weight x result, over 100)
- expert points = `w x x x` (mean level / 4), and **at most 50% of that** when every counted assessor is an AI
- observed or customer points = `w x o x` (sum of metric weight x result, over 100)

A check or metric nobody measured counts as zero and is listed in the report; it is never excluded and never estimated. The sum of `w x cap` over the twelve dimensions is **62.2**: the **ceiling** for automated and expert evidence alone. Dimensions 11 and 12 have cap 0 and no automated or expert evidence: they are outcome-defined (goals completed, value delivered) and are `not_measured` until observed or customer evidence exists. Engagement counts (opens, streaks, session time, scroll depth, notification click-through) are on the prohibited list and are rejected with a finding.

## Numbers the owner should review

These are proposals inside the proposed rubric; changing one is a new version:

- The split of each cap into an automated share and an expert share (for example 0.15 and 0.35 for dimension 1).
- The `floor` per dimension (0.5 to 0.7 of the non-observed ceiling) used by `build_verified`.
- `observed_minimum_n` = 5: an observed or customer result with fewer than five participants is rejected.
- The `max_fraction` of 0.5 that a blocking finding applies to its dimension.
- The check weights, metric weights and expert anchors.

## Adding a version

1. Copy the file to `bxqs-<next>.json`, change `version` and the content, and run `node services/brand-engine/src/cli.js rubric validate bxqs-<next>` (it will refuse until the next step).
2. Add its canonical sha256 and `released_at` to `released.json`.
3. Add a golden test set for it. The old version's golden tests stay as they are.
4. Open a pull request. `/brand/` is owned by the owner (CODEOWNERS); the owner ratifies by adding the ratification record in a reviewed merge.

---
title: ADR-0022 — Brand Experience Quality Score: an Evidenced Score, a Ceiling and an Attainment, and 90 Is Never Met by Inflation
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-10-23
---

# ADR-0022 — Brand Experience Quality Score: an Evidenced Score, a Ceiling and an Attainment, and 90 Is Never Met by Inflation

Purpose: record the scoring policy the owner accepted for the Brand Experience Quality Score (BXQS), how it is implemented in `services/brand-engine`, what it deliberately makes impossible (reaching 90 by inflation, or on automated and expert evidence alone), and what it takes to get there honestly.

> **Related documents:** [ADR-0021-brand-feeling-engine.md](ADR-0021-brand-feeling-engine.md) — the foundation this builds on, including the precedence rule · [../brain.brand_experience.md](../brain.brand_experience.md) — doctrine, section 10 · [../brain.autonomy.md](../brain.autonomy.md) section 3 — the honesty rule for unmeasured categories, which this reuses · [../brain.dopemine.md](../brain.dopemine.md) section 2 — the prohibited engagement metrics · [../brain.governance.md](../brain.governance.md) section 5 — the ethics gate · [../brand/rubrics/README.md](../brand/rubrics/README.md) — the rubric, its immutability and its semver policy · [../services/brand-engine](../services/brand-engine/README.md) — implementation.

---

## Status

Accepted — 2026-10-23. The scoring **policy** below is the owner's decision, given as the final instruction for this increment. The rubric that implements it (`bxqs-1.0.0`) is **proposed**: it is not ratified, and every number in it that the owner did not set (the share split of each cap, the floors, the minimum observed sample, the finding caps, the check and metric weights) is a proposal for the owner to review in the pull request.

## Context

The brief asks for a 100-point score with a 90-point release target that is never met by inflation, that separates automated results, expert assessment, observed behaviour and customer feedback, that reports blockers, confidence and missing evidence honestly, and that is versioned so history stays comparable. Two facts shape it. First, nothing in Dot.Brain can observe a user: automated checks and assessors see an artifact, not a person. Second, the repository already has an honesty rule for exactly this situation (`brain.autonomy.md` section 3): a category with no real signal scores zero, and is never excluded or estimated.

## Decision

1. **Three numbers, never one.** A report states the **evidenced score** (points actually earned, out of 100), the **ceiling** (the most the evidence classes present and allowed could earn) and the **attainment** (evidenced divided by ceiling). A single blended number is not produced. Numbers are truncated, never rounded up, so 89.99 can never be displayed as 90.
2. **Four evidence classes, with caps.** `automated_check`, `expert_assessment`, `observed_behaviour`, `customer_feedback`. Each dimension has a `cap_without_observed_or_customer` (the owner's table: 0.5, 0.6, 0.6, 0.8, 0.9, 0.7, 0.5, 0.7, 0.8, 0.8, 0 and 0 for dimensions 1 to 12). Implemented as shares: the cap equals the automated share plus the expert share, and the remainder of the weight can be earned only from observed or customer results.
3. **AI-only expert assessment counts at most 50% of the expert-eligible weight**, and the assessor kind (`human` or `ai`) is always recorded. Beside a human assessment, an AI assessment is kept as corroboration (it can reveal disagreement) and carries no points.
4. **The builder is never the sole assessor of its own change.** The input names `built_by`. As implemented this is stricter than the rule requires: a builder's assessment is always recorded and **never** earns points; if the builder is the only assessor of a dimension, the dimension has no counted expert evidence and the report says why. Assessor identity is declared in the evidence file, so it is checked for form, not proven (the same limit as ratification in ADR-0021).
5. **Unmeasured is 'not measured', counted as zero, shown, never excluded.** Every check and metric the rubric defines but the evidence lacks is listed in the report; none is dropped from the denominator or given a default. Points that cannot be earned without observed or customer evidence are listed as `points_capped_away`.
6. **Confidence is a band.** High: two or more source classes, including observed or customer evidence, on at least 50 points of weight. Medium: automated and expert evidence together on at least 50 points of weight, no observed or customer evidence on enough weight for High. Low: anything less (a single source, or expert only). Automated and expert evidence that disagree by more than one level on a dimension, or two assessors more than one level apart, make the band Low in every case (applied to High as well as Medium, which is stricter than the policy's wording).
7. **Blockers.** Any WCAG 2.2 A or AA failure; any unsupported-claim finding; a failing test in scope; a violated domain safety, regulatory or security override; an unresolved ethics-gate flag. A blocker stops the state at `not_ready`. A blocking finding also caps its dimension at half its weight.
8. **States.** `build_verified`: attainment at least 90 percent, no blockers, every dimension at or above its floor. `release_ready`: evidenced score at least 90, no blockers, observed or customer evidence on dimensions 3, 6 and 7 (and 8 where assistive-technology testing is possible), confidence Medium or better, **a ratified profile and a ratified rubric**, and, because the states are ordered, every `build_verified` condition including the floors. Otherwise `not_ready`. A draft, proposed or superseded profile or rubric caps the state at `build_verified`, and the report lists each unmet condition. The engine also requires `built_by` to be declared whenever expert assessments are supplied, because independence cannot be verified without it.
9. **Precedence (ADR-0021, decision 8).** A brand rule can never raise a score a safety, security or accessibility finding lowers: scoring is per dimension with no offset between dimensions, a blocking finding caps its own dimension whatever else it earned (observed evidence included), and the profile's `domain_overrides` are copied into the report. A brand rule is never recorded as having won.
10. **Dimensions 11 and 12 are outcome-defined.** Retention through continuing value and measurable customer outcomes allow only observed or customer evidence (goals completed, value delivered, outcomes the person stated). They are `not_measured` without it. Opens, streaks, session time, scroll depth, notification click-through, variable-reward effectiveness and time-to-return are prohibited (`brain.dopemine.md` section 2): a prohibited metric is rejected with a finding, flagged for human review, and never scored; a metric the rubric does not define is invalid input.
11. **The rubric is immutable once released, and versioned.** Its canonical sha256 is recorded in every report and in a ledger; a modified rubric is refused. MAJOR: the dimension set, a weight or a cap. MINOR: checks or metrics added or changed, a floor or policy number changed. PATCH: wording. `compare` refuses across a major version unless both reports are for the same commit, annotates minor differences, and never re-bases a number.
12. **Advisory, rules-only, owner-governed.** The score never blocks a deploy; no workflow runs it. There is no LLM in Brain: every sentence in a report is a fixed template, an id, or text supplied as input. A rubric change is strategic direction (Level 2 or 3): AI sessions may propose one and may never ratify it.

## Why 90 is out of reach on automated and expert evidence alone

Add up weight times cap over the ten dimensions that can be measured without people: 4 + 4.2 + 7.2 + 7.2 + 9 + 7 + 4 + 8.4 + 4.8 + 6.4 = **62.2**. That is the ceiling when the only evidence is machine checks and assessors reading the artifact. A perfect run (every check passes, a human expert gives every dimension the top level) earns 62.2, which is 100 percent attainment and `build_verified`, but not release. If the only expert is an AI, a perfect run earns 37.45 + 12.375 = 49.8, which is 80.1 percent attainment: not even `build_verified`. The other 37.8 points are reserved for what no tool can fake: whether people could use the thing, trusted it, got value from it, and got what they came for. Dimensions 11 and 12 (10 points) cannot be measured without people who have used the product more than once. To reach 90 honestly, at least 27.8 of those 37.8 reserved points must be earned from real observed or customer results while every automated and expert point is also earned.

What unlocks it is a **small observed or customer pilot**: a handful of real participants (the rubric requires at least five per result) doing the product's main tasks and giving their own account. That lifts the ceiling dimension by dimension (usability to 12, trust to 10, perceived value to 8, and so on) and is a condition of `release_ready` for dimensions 3, 6 and 7. The engine never closes that gap by itself, by a default, or by excluding what is missing.

## Consequences

- A product built entirely by an AI and assessed only by an AI cannot reach `build_verified`. A human expert assessment of the build is part of the minimum.
- Every report says what is missing. A reader can always see how much of a score is measured and how much is cap.
- Until the owner ratifies the profile and the rubric, no product can be `release_ready`, however good the evidence.
- The analysers (next increment) must produce the evidence file in the documented schema (`schemas/brand-evidence.schema.json`) using the check ids in the rubric; those ids are the contract.
- The twelve dimension ids, weights and caps are frozen for `1.x`. Changing one is `2.0.0` and breaks comparison with every earlier report.

## Alternatives considered

- **One blended score.** Rejected: it hides how much is measured. The ceiling and attainment make a low-evidence 60 distinguishable from a fully-evidenced 60.
- **Excluding unmeasured categories from the denominator.** Rejected: it would let an unmeasured product look as good as a measured one, the failure `brain.autonomy.md` section 7 exists to prevent.
- **Neutral defaults for missing checks.** Rejected: an estimate is a fabrication.
- **Counting AI and human assessment equally.** Rejected by the owner; an AI session is the builder's own tooling, and its agreement with itself is weak evidence.
- **Scoring with an LLM.** Rejected for the reasons in ADR-0021 decision 4.
- **A pass or fail gate on deploy.** Rejected by the owner: the engine is advisory.
- **Inferring user feelings from automated results.** Rejected: a report asserts that something is intended and what was measured, never that a person feels something.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-23 | Brand engine scoring (AI-drafted, owner to review) | Initial record of the accepted scoring policy and its implementation. |

## Open questions

- **Owner review of the proposed numbers** in the rubric: the automated/expert share of each cap, the floors, the minimum observed sample of five, the 0.5 cap a blocking finding applies, and the check and metric weights. Each is data in `bxqs-1.0.0.json`; changing one is a new version.
- **Whether `build_verified` should be reachable with an AI-only expert.** As accepted, it is not (80.1 percent at best). The alternative is a higher AI credit, which would contradict the owner's 50 percent rule, so it is recorded here and not changed.
- **Ratification of the rubric** is a record the owner adds in a reviewed merge (`brand/rubrics/README.md`). Branch protection requiring that review is a repository setting this ADR cannot create.
- **Analysers** that produce the evidence file, the Claude Skill and any Actions workflow are later increments; nothing here runs automatically.

---
title: ADR-0023 — Brand Engine Workflow: The Engine Reads Reports and Never Runs Tools, and a Fix Is Verified, Not Declared
version: 1.0.2
status: proposed
owners: [Chief Architect]
last-review: 2026-10-23
---

# ADR-0023 — Brand Engine Workflow: The Engine Reads Reports and Never Runs Tools, and a Fix Is Verified, Not Declared

Purpose: record how `services/brand-engine` connects the scoring foundation to real development work (analyse, plan, verify, assemble evidence), where the line sits between the engine and the external tools it learns from, and the rules that keep a plan from overriding safety, regulation, accessibility, security or correctness, and keep a claimed fix from being believed without a measurement.

> **Related documents:** [ADR-0021-brand-feeling-engine.md](ADR-0021-brand-feeling-engine.md) — placement, precedence, no LLM · [ADR-0022-bxqs-scoring-policy.md](ADR-0022-bxqs-scoring-policy.md) — the score the evidence feeds · [../brain.brand_experience.md](../brain.brand_experience.md) — doctrine · [../brain.dopemine.md](../brain.dopemine.md) §2 — the engagement metrics that are never targets · [../MANIFESTO.md](../MANIFESTO.md) rule 4 — Brain never edits platform-owned files · [../services/brand-engine](../services/brand-engine/README.md) — implementation · [../schemas/brand-analysis.schema.json](../schemas/brand-analysis.schema.json) · [../schemas/brand-plan.schema.json](../schemas/brand-plan.schema.json)

---

## Status

Proposed — 2026-10-23. Written by an AI session for the owner's review in the pull request. Nothing in it is ratified, and nothing in it changes a decision of ADR-0021 or ADR-0022.

## Context

The scoring engine counts the evidence it is given and has no way to produce any. The brief's workflow (discover, analyse, plan, implement, validate, record) needs the missing middle: something that reads a product repository, turns what other tools found into evidence in the schema the scorer takes, and says what to do next and whether it worked. Two constraints shape it. Brain is public and has no running application, so anything it runs must be safe on an arbitrary checkout; and an engine that executed linters, browsers or test runners would be executing the product repository's code. Second, the owner's honesty rules (unmeasured counts as zero and is shown; a builder is never the sole assessor; engagement is never a target) apply to a workflow exactly as they do to a score.

## Decision

1. **The engine reads reports; it never runs external tools.** The design detector, axe-core, Lighthouse, a test runner, a browser: each is run by something else (a GitHub Action, or the Claude Skill in a session) which writes a file. The engine's adapters (`src/analyze/adapters/`) accept that file, parse it strictly (bounded size, no DOCTYPE, no entities, no network, nothing executed, no free text copied except bounded and scrubbed fields) and produce evidence. The engine starts no process, opens no socket and reads no environment variable. Reports are formats other people own; each adapter documents the fields it reads, and the detector's format was learned from a real run of the installed tool.
2. **Adapters map only what the rubric measures.** Evidence is attached to a rubric check id and nothing else. The detector feeds `d2.impeccable_detect_findings` and `d4.detector_clean` (split so no finding scores twice); axe feeds `d8.axe_violations`; test results feed `d5.test_pass_counts` and, for tests tagged as error paths, `d10.error_path_tests`; Lighthouse's accessibility audits feed `d8.axe_violations` at lower priority than axe. Lighthouse best-practices and performance have no rubric check, so they are noted in the analysis and never scored. A check id supplied by two sources is a conflict, and neither is counted.
3. **Checks are code, isolated.** Built-in static checks are modules in `src/analyze/checks/` that follow a written contract (`check-shape.js`); the registry loads them, and runs each in a worker thread with a timeout, an empty environment and a read-only, root-confined file API (`files.js`: no path escape, no symlink escape, no vendored, minified, binary, oversized or credential-named file). A check that throws, loops, runs out of memory or returns something that breaks the contract becomes `not_measured` with an engine finding. It is never a pass. `--checks-dir` may only point inside the engine's own package: check modules are never loaded from the product checkout.
4. **The analysis is a document with an integrity hash.** `analysis.json` holds the evidence, the findings and an explicit `not_measured` list with the reason for each (no check, no report, not applicable, errored, conflicting). It carries no clock and no absolute path, so the same input is byte-identical. `plan` and `verify` refuse a document whose hash no longer matches (exit 3): a baseline cannot be edited to fake an improvement.
5. **A plan proposes work and withholds work.** Findings are grouped by root cause into tasks ranked blockers first, then expected points per estimated effort (the effort table is an estimate for ordering only), then dimension order and id. Each task states the dimension and principle it serves, the profile it came from, the files and lines, and an acceptance criterion that is a re-runnable check. Precedence (ADR-0021 decision 8) is enforced: a brand-dimension task whose principle the profile says yields to accessibility, regulation, security, safety or functional correctness is **withheld** while that concern has an open blocker on the same files (or any blocker, where no file is known). A task about retention, outcomes, the habit or retention principles, or an engagement metric is flagged `needs_human` and never ranked. The engine does not edit the product repository; it writes only where `--out` and `-o` say, and never inside the checkout.
6. **A fix is verified by measurement.** `verify` re-analyses the checkout and diffs finding sets by stable id. A finding counts as fixed only if its check was measured again; one whose check is no longer measured is `unverifiable`, never fixed. A new finding in a check measured both times, or a lower measured value, is a regression (exit 1). A task someone claims is done whose acceptance still fails is `claimed_not_landed` (exit 1). Verdict `inconclusive` (exit 3) means nothing measured improved and something could not be measured. Comparing across a different rubric hash, profile, repository or a modified baseline is refused.
7. **Evidence assembly drops nothing that matters and invents nothing.** `evidence assemble` turns the analysis plus the two files a person writes (expert assessments with the rubric anchor recorded beside the level; observed results with `participants: "human"` and the rubric's own metric ids) into the evidence file `score` takes, validated with the scorer's own validator. A prohibited engagement metric is refused with its reason. A blocker that cannot be given a score kind, or a WCAG failure without a criterion, refuses the assembly instead of vanishing. `generated_at` comes from the caller or the manual files, never a clock. Provenance for every automated value (the check module or report it came from) and the hashes of the inputs travel in `x-provenance`.

## Consequences

- A Claude Skill or an Action can drive the whole loop with five commands and files, and nothing the engine does depends on a network or on trusting the product repository's code.
- Reports must be produced and supplied again to verify them. A baseline measured with an axe report cannot be verified without one; the verdict says so rather than guessing.
- Findings are matched across runs by check, file and message. A check should put a stable identifier of the offending element in its message (an image's `src`, not its line number), or two identical findings in one file cannot be told apart and fixing one while adding another reads as no change.
- The numbers an adapter has to choose (the detector ceiling of ten findings, the pass share for axe, the error-path tag) are proposals in the same sense as the rubric's weights: the owner reviews them in this pull request.
- A ceiling is a floor once it is reached (ten detector hits and 191 read the same). The adapter therefore marks the evidence `saturated` and says so in its detail; the score leaves a saturated result out of the automated-versus-expert comparison and lists a confidence reason, and changes no number. How the detector should be scaled instead is a rubric change and is written up as a proposal (`brand/proposals/BRP-2026-10-24-detector-ceiling-and-third-party-origins`), not decided by the adapter. The comparison rule is the one place this touches the confidence policy of ADR-0022; it is recorded here, for the owner to confirm, because ADR-0022 is the owner's accepted decision and was not edited.
- Each document (analysis, evidence file, score report) names the lowest schema version that can describe it, so a document that uses no 1.1.0 feature is the same bytes as before and an old file stays valid.
- A scope (`analyze --scope`) is part of the methodology: the report records it, `verify` keeps the baseline's and refuses a different one.
- Adding a check is a new file in `src/analyze/checks/`; adding an adapter is a new module and a row in the routing table, with a new fixture and tests. Neither changes the rubric.

## Alternatives considered

- **Run the tools from the engine.** Rejected: it would execute the product's dependencies and configuration from a public tool run on arbitrary checkouts, and add a network and process surface to a rules-only service.
- **Treat a report as already-scored evidence.** Rejected: the rubric, not the tool, defines what a check means; an adapter that maps a tool's number to a check it does not measure is a fabrication.
- **Run checks in the main thread.** Rejected: a synchronous loop cannot be timed out in-process, and a throwing check must not abort the run.
- **Drop a blocker that has no score kind.** Rejected: a score that silently omits a blocker is a score that lies.
- **Let `verify` accept the implementer's word.** Rejected: that is the failure it exists to prevent.
- **Let the plan propose engagement work to a person later.** Rejected for the plan itself: engagement-related work is listed apart and never ranked, so it cannot be mistaken for a proposal.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-23 | Brand engine workflow (AI-drafted, owner to review) | Initial decision record for analyse, plan, verify and evidence assembly, and the adapter boundary. |
| 1.0.1 | 2026-10-23 | Brand engine governance, Skill and Action (AI-drafted, owner to review) | The open question about the Skill and the Actions workflow now points to ADR-0024; no decision above changed. |
| 1.0.2 | 2026-10-24 | Brand engine Phase 1 fixes (AI-drafted, owner to review) | Consequences: a reached ceiling is visible (`saturated`) and left out of the confidence comparison, documents name the lowest schema version that describes them, and a scope is recorded and kept by `verify`. No decision above changed. |

## Open questions

- **Owner review of the adapter choices:** the detector ceiling of ten (and the proposal that replaces its scaling), axe's rule-level pass share, the `[error-path]` tag, treating contrast hits from the detector as detail (d4) findings, and the default theme list (`light`, `dark`).
- **The effort table** (S, M or L per check) is a first estimate for ordering; it should be revised once real plans exist.
- **Lighthouse performance and best-practices** are noted and not scored because the rubric has no check for them. Whether the rubric should have one is a rubric change (a new version), not a workflow change.
- **The Claude Skill and the Actions workflow** that call these commands are decided in [ADR-0024](ADR-0024-brand-engine-governance-skill-action.md) (proposed). The Action reads reports a product committed and does not run the external tools; running them in CI remains a later decision.

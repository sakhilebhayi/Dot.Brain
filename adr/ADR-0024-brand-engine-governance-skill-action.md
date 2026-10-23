---
title: ADR-0024 — Brand Engine Governance, the Thin Claude Skill and the Assessment Action: Only a Human Ratifies, the Skill Holds No Knowledge, and the Action Reads and Reports
version: 1.0.0
status: proposed
owners: [Chief Architect]
last-review: 2026-10-23
---

# ADR-0024 — Brand Engine Governance, the Thin Claude Skill and the Assessment Action: Only a Human Ratifies, the Skill Holds No Knowledge, and the Action Reads and Reports

Purpose: record how changes to the Brand Feeling Engine's knowledge (profiles, principles, the rubric, the doctrine) are proposed and kept from being changed silently, how a Claude Skill reaches the engine without becoming a second source of truth, and how a reusable GitHub workflow runs the engine read-only on a product repository.

> **Related documents:** [ADR-0021-brand-feeling-engine.md](ADR-0021-brand-feeling-engine.md) — placement, "recommend, never ratify", the precedence rule · [ADR-0022-bxqs-scoring-policy.md](ADR-0022-bxqs-scoring-policy.md) — the score the Action reports · [ADR-0023-brand-engine-workflow-adapter-boundary.md](ADR-0023-brand-engine-workflow-adapter-boundary.md) — the commands the Skill and the Action drive · [../brain.brand_experience.md](../brain.brand_experience.md) — the doctrine · [../brain.autonomy.md](../brain.autonomy.md) — strategic direction is Level 3 · [../brain.governance.md](../brain.governance.md) — no actor approves their own proposal · [../services/brand-engine/docs/owner-checklist.md](../services/brand-engine/docs/owner-checklist.md) — what only the owner can do

---

## Status

Proposed — 2026-10-23. Written by an AI session for the owner's review in the pull request. Nothing in it is ratified, and nothing in it changes a decision of ADR-0021, ADR-0022 or ADR-0023.

## Context

ADR-0021 says an AI session may propose a profile or principle and never ratify one, and that the engine ratifies nothing. Until now that rested on the validator's form checks and on the owner's review. Three things were still missing. There was no agreed shape for a *proposal* to change a profile, a principle, the rubric or the doctrine, so a lesson had nowhere to go except a direct edit. There was no mechanical guard against a ratified file being edited without a trace. And the two ways the engine reaches real work, a Claude session and a CI run, did not exist: the engine was a command line someone had to know about.

Facts that shape the decision:

- Dot.Brain is public and has no running service. Everything here is a zero-dependency Node package and files, reviewed by the owner's merge (ADR-0021 context).
- The CLI reads no environment variable and no clock (ADR-0023). A governance command that needs a time takes it as a flag.
- A Skill is Markdown a model follows. If it carried the rubric it would be a second copy that could drift (ADR-0021, "A Claude Skill as the source of truth", rejected).
- GitHub Actions can run Node, check out another repository and upload an artifact with a read-only token. Dot.Memory and Dot.Dopemine have no contract an Action could use today.

## Decision

### Governance

1. **A proposal is a file.** `brand-proposal/1` ([schema](../schemas/brand-proposal.schema.json)). It names its target (`profile`, `principle`, `rubric` or `doctrine`, with the version and sha256 it was written against), what changes and why, the evidence (each item in one of the five evidence classes of ADR-0021), the affected products, the risk, the rollback, an acknowledgement of the precedence rule, and a changelog entry for the version it produces.
2. **The lifecycle is `draft`, `proposed`, `ratified`, and only a human reaches the last.** The proposal carries a `history` of who moved it and when. `propose init` writes a draft. `propose submit` moves a draft to `proposed` after the lint passes, for any actor, human or AI, and writes nothing if it does not. No command, flag or code path sets `ratified`: the owner edits the file in a reviewed merge, and a test proves the writing code never produces the word. The lint checks the *form* of a ratification (a human approver, a history entry by that human, `proposed` first, the same time) and refuses an AI actor, an approver marked AI or listed as an AI contributor, a skipped step and a status that disagrees with the history. What makes a ratification real is CODEOWNERS and the owner's merge, as in ADR-0021.
3. **A proposal must be complete to be proposed.** From `proposed` on, the lint refuses placeholder or label-only text, missing evidence, evidence with the wrong fields for its class, confidence above what the classes support, no affected product, and a base that is stale (the target changed after the proposal was written). A draft may be incomplete; its gaps are warnings.
4. **A citation is evidence only once a human has verified it.** `documented_research` with `citation_verified: false` is refused. `citation_verified: true` needs `verified_by` and `verified_at`, and an AI cannot be the verifier. This is the rule that governs the three unverified citations already recorded in the principles.
5. **Brand never outranks the things that outrank it.** A proposal must acknowledge the precedence rule, cannot set `weakens_precedence`, and resolves every conflict with safety, regulation, accessibility, security or functional correctness as `brand_yields`. These refusals apply to drafts too.
6. **A ratified document is never edited silently.** A change to a ratified target is a new version (`edit_mode: new_version`, a higher `to_version`, a changelog entry), and `in_place` is refused. A released rubric is immutable, so a rubric change is always a new version, and its kind (`dimension_set_weight_or_cap` major, `checks_metrics_floors_policy` minor, `wording` patch) must match the version bump.
7. **A ledger pins what was ratified.** [`brand/governance/changelog.json`](../brand/governance/changelog.json) is the versioned changelog. Its `ratified` entries pin the sha256 of each ratified version, added by the owner in a reviewed merge. `lint-proposal --check-ratified` compares every ratified profile, principle and doctrine on disk, and every released rubric, with it, and refuses a changed, downgraded, rolled-back, unrecorded or removed ratified document. The test suite runs it on the shipped data, so a pull request that edits a ratified file without the owner's ledger entry fails the `tests` workflow.
8. **Engagement-related principles go through the ethics gate.** A proposal to an engagement-related principle must set `ethics_review: required` (brain.dopemine.md, brain.governance section 5).

### The Claude Skill

9. **The Skill is an interface, not a source of truth.** `services/brand-engine/skill/dot-brand-experience/` holds `SKILL.md` and two reference files. It calls only the engine CLI (`analyze`, `plan`, `verify`, `evidence assemble`, `score`, `propose`, `lint-proposal`, and the read commands for profiles, principles and the rubric reference). It holds no rubric, no weights, no check id, no hash and no scoring logic; a test fails if any rubric id or the rubric hash appears in it. It states the rules it must follow (advisory only; evidence honesty, including that the builder never earns points and that an AI-only expert assessment is capped; dimensions 11 and 12 not measured without real data; the precedence rule; never ratify; no simulated integration) and sends the reader to the engine for every number.
10. **The installer is the owner's to run.** `skill/install.js` copies the skill to `~/.claude/skills/dot-brand-experience` and writes one extra file, `engine.path`, holding the path of this checkout's engine so the Skill does not search the disk. It never overwrites a differing file without `--force`, never deletes, and has a `--dry-run`. Nothing and no test runs it against a real home directory.
11. **The Skill has no integration it cannot use.** It does not call Dot.Memory or Dot.Dopemine and says so; where a step needs a connection that does not exist it stops and reports.

### The Action

12. **A reusable workflow, called or dispatched, never triggered.** `.github/workflows/brand-assess.yml` has `workflow_call` and `workflow_dispatch` and no other trigger. It checks out Dot.Brain at `brain_ref` (the engine) and the product at `repository`/`ref`, validates every input, runs `analyze`, `evidence assemble` and `score` with the output outside the product checkout, writes a job summary, uploads the reports as an artifact, and exposes `state`, `evidenced_score` and `blockers` as outputs.
13. **Advisory, read-only, no secrets.** It fails only when the engine fails, or on a blocker when the caller sets `fail_on_blockers: true` (default `false`). It has `permissions: contents: read`, declares no secret, commits nothing, opens no pull request and posts nothing to Dot.Memory or Dot.Dopemine, because no contract exists to post to. Inputs reach the shell only as environment variables. The evidence is dated by the commit's own time, so the same commit gives the same report.
14. **It runs no external tool.** The design detector, axe, Lighthouse and a test runner are not run by the Action. The engine reads reports a product has committed (`reports_path`); a check with no report is "not measured" and counts as zero, visibly. Running those tools in CI is a later decision with its own review.
15. **Private repositories call it from inside.** The Action uses the run's own token and no stored credential, so it can check out the calling repository and any public repository. A private product repository calls it from its own workflow. A cross-repository read of a private repository would need a read-only token the owner creates (open question).
16. **The tests run the workflow's own shell.** A fixture test extracts the workflow's `run:` steps, runs them with bash in a fake runner on the synthetic e2e product, and checks the outputs, the summary, the gate, determinism, that the product checkout is byte-for-byte unchanged, and that a symlink leaving the checkout is refused. Static tests pin the triggers, the permissions, the absence of secrets, writes and network commands, the action pins and that no input is expanded into a script.

## Consequences

- An AI session can take a lesson as far as `proposed` and no further; the owner's merge is the only way to `ratified`. A proposal that would weaken safety, accessibility or the other overriding concerns cannot be proposed.
- Editing a ratified profile, principle, doctrine or rubric without the owner's ledger entry fails CI, instead of relying on a reviewer to notice.
- A developer with the Skill installed, or a repository with a three-line workflow, can run the whole assessment loop without learning the CLI. Neither can raise a score or declare a product ready: every number is the engine's.
- Evidence honesty is unchanged. With automated evidence only, the ceiling stays below 90, and the Action's summary says so beside the numbers.
- Every governed file path is routed to the owner by CODEOWNERS (the new schemas, the governance code, the ledger, proposals, the rubric, the doctrine, these ADRs, the Skill, the CI helper, the workflow, and CODEOWNERS itself).

## Alternatives considered

- **A governance service with an API and a database.** Rejected: Dot.Brain has no running service (ADR-0021), and a file reviewed by merge is the process already in force.
- **Let `propose` take a `--status`.** Rejected: the one status that matters must be impossible to write from the command line, so the code that writes proposals does not contain it.
- **Trust the reviewer to notice an edit to a ratified file.** Rejected: a hash in a ledger the owner controls makes the edit fail a test rather than depend on attention.
- **A Skill that bundles the rubric for offline use.** Rejected: a second copy drifts, and an old copy would score by old rules. The Skill needs the checkout it runs anyway.
- **An Action that runs axe, Lighthouse and the detector.** Rejected for now: it adds a browser, network installs and the product's configuration to a run on arbitrary checkouts, which ADR-0023 decision 1 keeps out of the engine. Reports a product already produced are read instead.
- **An Action that comments on the pull request or commits the report.** Rejected: it needs write permission, and the product's quality is not the Action's to broadcast. The artifact and the job summary are visible to those who can already see the run.
- **An Action that posts scores to Dot.Memory.** Rejected: no contract exists (ADR-0021 decision 7 defers it), and a call to an undefined endpoint would be a simulated integration.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-23 | Brand engine governance, Skill and Action (AI-drafted, owner to review) | Initial decision record. |

## Open questions

- **Branch protection.** Whether the repository requires a CODEOWNERS review on `/brand/` and the other governed paths is a setting only the owner can make (listed in the owner checklist). Without it, CODEOWNERS routes a review and does not require one, and ratification by merge is a convention, not a control.
- **Who may ratify.** The lint warns, and does not refuse, when the approver is also the author, because the owner is the only ratifier and may write a proposal. `brain.governance.md` says no actor approves their own proposal; the owner decides whether that warning should become a refusal and who a second human approver would be.
- **The ledger starts empty.** Nothing is ratified, so the changelog has no entries. The first ratification is the owner's to record, with the sha256 the lint prints.
- **Private repositories from outside.** Assessing a private repository from Dot.Brain's own workflow needs a read-only token the owner creates and a decision about where the report may be stored.
- **Pinning.** A caller pins the workflow with `@<sha>` and the engine with `brain_ref: <sha>`; the two are separate inputs because a reusable workflow cannot read its own ref. Whether to make `main` a protected, tagged release line is the owner's.
- **actionlint in CI.** The workflow is actionlint-clean when checked locally and the test suite runs actionlint when it is installed. The repository's `tests` workflow does not install it, so CI does not enforce it.
- **The installed Skill points at a checkout.** `engine.path` is an absolute path; moving the Dot.Brain checkout means running the installer again.

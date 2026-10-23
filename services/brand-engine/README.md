# Dot.Brain — Brand Engine

The registry, checker and scoring engine behind the Brand Feeling Engine (ADRs:
[ADR-0021](../../adr/ADR-0021-brand-feeling-engine.md) foundation, [ADR-0022](../../adr/ADR-0022-bxqs-scoring-policy.md) scoring; doctrine:
[brain.brand_experience.md](../../brain.brand_experience.md); design:
[spec](../../docs/superpowers/specs/2026-10-23-brand-engine-foundation-design.md)).

It loads the reviewed data in [`brand/`](../../brand/README.md), validates it, resolves a profile's
`extends` chain, and checks that the files a profile cites have not drifted. It is **read-only,
offline, and has no LLM**. It decides nothing about a brand and ratifies nothing. Since 0.2.0 it also
**scores**: given an evidence file it computes the Brand Experience Quality Score (BXQS) report described
below. Since the workflow increment it also **analyses** a checkout, **plans** the work, **verifies** the result
and **assembles** the evidence file (see "Workflow" below). It never runs another tool: it reads the reports
that tools wrote. Nineteen of the rubric's automated checks run by reading a checkout (contrast, copy and claims,
static accessibility, token consistency, structure): see [docs/static-checks.md](docs/static-checks.md). It also
**governs its own knowledge** (`propose`, `lint-proposal`: only a human ratifies), ships a thin Claude Skill that drives
the commands, and a reusable GitHub workflow that assesses a repository read-only (see "Governance", "The Claude Skill"
and "The assessment Action" below; decisions: [ADR-0024](../../adr/ADR-0024-brand-engine-governance-skill-action.md), proposed).

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
node src/cli.js analyze <path> [--profile <id|file>] [--reports <dir>] [--out <dir>]
node src/cli.js plan <analysis.json> [--out <dir>]
node src/cli.js verify --before <analysis.json> <path> [--plan <plan.json>] [--claimed <ids|all>] [--reports <dir>] [--out <dir>]
node src/cli.js evidence assemble --analysis <analysis.json> --built-by <id> [--assessments <f>] [--observed <f>] [-o <evidence.json>]
node src/cli.js propose init --target <profile|principle|rubric|doctrine>:<id> [--new] --author-id <id> --author-kind <human|ai> --author-name <name> --created-at <date-time> [--slug <words>] [-o <file>]
node src/cli.js propose submit <proposal.json> --actor-id <id> --actor-kind <human|ai> --at <date-time> [-o <file>]
node src/cli.js lint-proposal <proposal.json>... [--json]
node src/cli.js lint-proposal --check-ratified [--json]
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

`analyze`, `plan`, `verify` and `evidence assemble` use: `0` done (verify: improved, or no change), `1` verify
only: regressions, or a claimed task that did not land, `2` invalid input (usage, a malformed file or report, an
unknown profile), `3` refused (invalid brand data, a modified rubric or document, a comparison that proves
nothing, an inconclusive verify).

`propose` and `lint-proposal`: `0` done or clean (warnings do not fail), `1` the lint refused a proposal (`propose submit` then
writes nothing), `2` invalid input (usage, an unreadable or malformed file, a time that is not a date-time), `3` `propose submit` was given
a proposal that is not a draft.

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

JSON, [`schemas/brand-evidence.schema.json`](../../schemas/brand-evidence.schema.json). `evidence assemble`
(below) produces it from an analysis and the two files a person writes; a test may also write it by hand. Check ids and metric ids are those in the rubric
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

## Workflow: analyse, plan, verify, assemble

Decision record: [ADR-0023](../../adr/ADR-0023-brand-engine-workflow-adapter-boundary.md) (proposed). The engine
**reads reports and never runs external tools**; the Action or the Claude Skill runs the design detector, axe,
Lighthouse and the test runner, and drops their output in a directory.

```
tools (run elsewhere) --> reports/ ----------------------------+
product checkout --> analyze --> analysis.json --> plan --> plan.json / plan.md
                        |             |                          (someone applies the tasks)
                        |             +--> verify --before analysis.json <checkout> --> verification.json
                        +--> evidence assemble (+ assessments + observed) --> evidence.json --> score
```

### analyze

`analyze <path> [--profile <id|file>] [--reports <dir>] [--out <dir>] [--repo <owner/name>] [--commit <sha>] [--themes light,dark] [--rubric <ref>]`

- **Profile.** `--profile` (a Brain profile id or a path), else `<path>/brand/profile.json`, else exit 2. The profile is resolved and handed to every check as `ctx.profile`.
- **Checks.** Every module in `src/analyze/checks/` runs (registry below). **Reports.** Every file in `--reports` is routed to an adapter (below).
- **Output.** Without `--out`, `analysis.json` on stdout. With `--out <dir>`: `analysis.json` and `summary.md` (and the summary on stdout). `--out` inside the checkout is refused (exit 2).
- **Identity.** The commit and `owner/name` come from `<path>/.git` (HEAD, refs, `packed-refs`, `config`) read directly; git is never run and the remote URL is never output. `--repo` and `--commit` fill in a checkout that is not a git repository, and may not contradict one that is.
- **Deterministic and read-only.** No clock, no absolute path, no environment value; the same checkout, profile and reports give the same bytes; a test checksums the checkout before and after.
- **Not measured.** Every rubric automated check without counted evidence is listed in `not_measured` with a reason: `no_check_registered`, `no_report_supplied`, `report_had_no_data`, `not_applicable`, `check_not_measured`, `check_errored`, `conflicting_sources`. The score counts each as zero and says so.
- `analysis.json` is validated against [`schemas/brand-analysis.schema.json`](../../schemas/brand-analysis.schema.json) and ends with `integrity.sha256`.

### The check registry and the file API

A check is `src/analyze/checks/<id with "." and "_" as "-">.js` (for example `d8-token-pair-contrast.js`) and
default-exports `{ id, dimension, title, appliesTo(ctx), run(ctx) }`. `run` returns
`{ status: 'measured' | 'not_applicable' | 'not_measured', evidence: [{ check_id, source_class: 'automated_check', result, detail?, artifact_ref? }], findings: [{ id, severity, dimension, check_id, message, location?: { file, line }, fix_hint }] }`
where `result` is a number from 0 to 1 (or `"pass"` / `"fail"`), `severity` is `blocker | major | minor | info`, and a
finding may add `kind`, `wcag_level`, `wcag_criterion` and `principle` (see "From findings to the score").
`ctx = { root, profile, files: { list(globs), read(rel), exists(rel) }, themes }`.

- `files` is read-only and confined to the checkout: no `..`, no absolute path, no symlink that leaves the root, no vendored, generated, minified, binary, oversized (1 MiB) or credential-named (`.env`, `*.pem`, `id_rsa`, ...) file, a total read budget, and a record of everything it declined to read. `read` returns the text, `null` if missing, and throws `FileAccessError` (with a `code`) for anything refused.
- `themes` defaults to `["light", "dark"]` (`--themes`); the engine does not discover themes, it tells a check which to evaluate.
- Each check runs in its **own worker thread** with a 30 s timeout, an empty environment and discarded console output. A check that throws, loops, runs out of memory or returns a result that breaks the contract becomes `not_measured` with an engine finding (severity `major`, `engine: true`). It is never a pass and never stops the run. Files starting `_`, `_lib/` and sub-directories are not checks; a mis-named or symlinked module is reported.
- The built-in checks are the modules in `src/analyze/checks/` (nineteen of the thirty-seven automated checks in the rubric; the other eighteen need a browser, a test run or an external report and are listed with their reasons in [docs/static-checks.md](docs/static-checks.md)). They use `ctx.files` when it is given.
- `--checks-dir <dir>` loads modules from another directory **inside the brand-engine package** (used by the tests). Check modules are code: they are never loaded from a product checkout.

### Adapters

`--reports <dir>` is read non-recursively (at most 50 files, 8 MiB each, 32 MiB in all; symlinks and binaries skipped and listed). A file is routed by name, then by content; a file that is routed to an adapter and is not what it claims to be is **exit 2**, a file nobody recognises is only listed.

| Tool and file | Adapter | Evidence (rubric check) | Findings |
|---|---|---|---|
| Design detector, `impeccable detect --json` (`*detect*.json`, `*impeccable*.json`): an array of `{ antipattern, name, description, severity, category, file, line, snippet }` | `detector` | `d2.impeccable_detect_findings` (identity: category `slop`) and `d4.detector_clean` (everything else, motion rules included): `1 - n / 10`, n = distinct counted hits; advisory hits are listed, not counted | one per hit, severity `minor` (`info` for advisory) |
| axe-core results (`*axe*.json`; one object or an array of pages) | `axe` | `d8.axe_violations`: passing rules / (passing + failing), pooled over pages | one per violated rule per page; WCAG level A or AA: `blocker`, kind `wcag_failure`, criterion from the `wcagNNN` tag |
| Lighthouse JSON (`*lighthouse*.json`) | `lighthouse` | `d8.axe_violations` from the accessibility audits (audit level; axe wins if both). Best-practices and performance are **noted, never scored** (no rubric check measures them) | failed audits, `major`, no WCAG level invented |
| JUnit XML (`*junit*.xml`, or any XML with a `<testsuite>`) and TAP (`*.tap`) | `tests` | `d5.test_pass_counts`: passed / (passed + failed), skipped and TODO not counted, pooled over files; `d10.error_path_tests` over tests tagged `[error-path]` or `@error-path` | one per failed test: `blocker`, kind `failing_test` |

Every adapter parses strictly (JSON and TAP with limits; XML with a small reader that has no DOCTYPE, no entities and no backtracking), rejects malformed input with a clear message, never executes anything, and copies free text only through a gate that strips control characters, redacts credential-shaped strings and clips the length. URLs lose their query and fragment. A check id supplied by two sources (a module and a report, or two modules) is a conflict: neither is counted and the analysis says so.

### The two files a person writes (`evidence assemble --assessments / --observed`)

```json
{ "format": "brand-assessments/1", "recorded_at": "2026-10-23T12:00:00Z",
  "assessors": [{ "id": "jane", "kind": "human" }],
  "assessments": [{ "dimension": "usability_cognitive_load", "assessor": "jane", "level": 3,
                    "notes": "up to 700 characters, in the assessor's words", "artifact_ref": "notes/jane.md" }] }
```

The level must be 0 to 4 and the dimension one the rubric allows an expert to assess; the engine records the **rubric anchor** for that level beside the notes. `kind` is recorded as written (`ai` assessments are scored at the policy's reduced credit by `score`).

```json
{ "format": "brand-observed/1", "recorded_at": "2026-10-23T12:30:00Z",
  "observations": [{ "dimension": "usability_cognitive_load", "source_class": "observed_behaviour",
                     "metric_id": "task_completion_rate", "value": 0.8, "n": 8, "method": "Moderated sessions",
                     "participants": "human", "artifact_ref": "notes/sessions.md" }] }
```

The metric must be one the rubric defines for that dimension and class. `participants` must be `"human"`: a simulated or AI-driven run is refused (record it as automated or expert evidence). **A prohibited engagement metric (session time, opens, streaks, scroll depth, notification click-through, variable reward, time to return, and their aliases) is refused with its reason, never dropped.** Unknown keys are refused; credential-shaped strings are refused.

### plan

`plan <analysis.json> [--out <dir>]` writes `plan.json` ([`schemas/brand-plan.schema.json`](../../schemas/brand-plan.schema.json)) and, with `--out`, `plan.md`, a task list to paste into an issue or pull request.

- **Grouping:** findings with the same check and root cause (the fix hint without numbers, selectors or parenthesised detail) are one task.
- **Order:** blockers first; then expected points per effort (rubric points the check can still earn, split across the check's tasks; effort S=1, M=3, L=8 from a table in `src/analyze/tables.js`, one size up when a task touches more than five files); then dimension order and task id. Effort is an estimate **for ordering only**.
- **Each task:** id (`T-` + hash of the root cause, stable between runs), title, `why` (dimension, principle `BXP-NN`, profile, the profile's standards for it), files and lines, fix hints, `acceptance` (a re-runnable check id and the finding ids that must be gone), effort, expected points, risk and notes, the profile's domain overrides for its principle.
- **Precedence:** a task in a brand dimension whose principle the profile says yields to accessibility, regulation, security, domain safety or functional correctness is **withheld** (listed, not proposed) while that concern has an open blocker on the same files, or any blocker where no file is known.
- **Engagement:** a task about retention or outcomes (dimensions 11 and 12), the habit and retention principles (BXP-09, BXP-10), or text naming an engagement measure is `needs_human`: listed apart, never ranked, never proposed.
- Engine problems (a check that could not run) are listed apart; they are not product tasks.

### verify

`verify --before <analysis.json> <path> [--profile ..] [--reports <dir>] [--plan <plan.json>] [--claimed T-id,...|all] [--out <dir>]` re-analyses the checkout (same rubric, profile and themes as the baseline) and diffs by finding id.

| Result | Meaning |
|---|---|
| `fixed` | in the baseline, gone now, **and its check was measured again** |
| `still_open` | in both |
| `new` | a regression: not in the baseline, from a check measured in both |
| `newly_measured` | from a check the baseline did not measure; information, not a regression |
| `unverifiable` | its check is no longer measured; neither fixed nor open |

For each plan task: `landed` (check measured, none of its findings left), `open`, `claimed_not_landed` (claimed with `--claimed`, findings remain), `claimed_unverifiable`. Verdicts and exit codes: `regressed` (a new finding, or a measured value lower) 1; `claims_not_landed` 1; `inconclusive` (nothing measured improved and something cannot be measured, or a claimed task cannot be verified) 3; `improved` (a measured fix or higher value, nothing worse) 0; `no_change` 0. A baseline that was edited (its integrity hash fails), a different rubric hash, profile, major version or repository, and a plan made from another analysis are **refused (3)**. With `--out`, `verification.json`, `verification.md` and the new `analysis.json` are written.

Findings are matched by check, file and message. A check should put a stable identifier of the offending element in the message (an image's `src`, not a line number); otherwise two identical findings in one file cannot be told apart.

### evidence assemble

`evidence assemble --analysis <analysis.json> --built-by <id> [--assessments <f>] [--observed <f>] [--generated-at <date-time>] [--repo ..] [--commit ..] [--assistive-tech true|false] [-o <file>]` writes an evidence file `score` accepts, validated with the scorer's own validator before it is written.

- Every counted automated value, with `artifact_ref` naming its source (`check:<id>` or `adapter:<tool>:<report>`); expert and observed entries exactly as the manual files give them; `x-provenance` with the analysis, assessments and observed hashes and the source of each automated value.
- `--built-by` is required: the scorer cannot verify independence without it. `generated_at` is `--generated-at`, else the latest `recorded_at` of the manual files, else an error (the engine reads no clock). A checkout without a GitHub origin or a commit needs `--repo` and `--commit`.
- **From findings to the score.** Only blockers (and AAA WCAG notes) reach the score. The kind comes from the finding's `kind` or, failing that, a default by check id (`d8.*` contrast, axe, labels and focus: `wcag_failure`; `d6.claim_lint`: `unsupported_claim`; `d5.test_pass_counts` and `d10.error_path_tests`: `failing_test`). A WCAG failure needs a level and a criterion (`d8.token_pair_contrast` defaults to AA 1.4.3, `d8.focus_visible` to AA 2.4.7, `d8.labels_alt_lang` to level A with a criterion read from the message). **A blocker that cannot be given a kind, or a WCAG failure without a criterion, refuses the assembly** (exit 2) and names the finding.

### Workflow tests

`test/flow.*.test.js`: the file API (path traversal, symlink escape, huge, binary and minified files, budgets, globs), the registry (contract, auto-load, `_lib/` ignored, timeout, error isolation, an empty environment), every adapter (valid, malformed and hostile input, size caps, prohibited metrics, simulated participants), analyze (determinism, read-only, `.git` parsing, redaction, rubric cross-checks, not-measured reasons, conflicts), plan (grouping, order, precedence, engagement), verify (fixed, open, new, unverifiable, claimed-not-landed, refusals), the CLI (exit codes, no environment value in any output, atomic `-o`), the documents, and `flow.e2e.test.js`: a synthetic product (`test/fixtures/e2e`, marked fixture) with three seeded defects (a low-contrast token pair, an unsupported claim, an image with no alt text) goes through analyze, plan, a false claim (not believed), a partial fix, a real fix, verify, assemble and score. The fixture checks in `test/fixtures/e2e/checks` are stand-ins, not the built-in checks.

`test/checks/*.test.js` covers the built-in checks: the contrast maths against published WCAG reference values, the template, CSS and route readers, the contract (every module is a rubric check id on its rubric dimension; every rubric check is built or listed as skipped), exact findings (rule, severity, file and line) on a known-bad and a known-good synthetic checkout, the boundaries (4.5 and 3.0 contrast, heading order, `alt=""`, evidence markers, dynamic fragments, `not_measured` instead of a pass), path escape and symlinks, a read-only and no-network source scan, determinism, a 2,000-file performance check, and the whole chain through `analyze`, `assemble` and `score`.

## Governance

Decision record: [ADR-0024](../../adr/ADR-0024-brand-engine-governance-skill-action.md) (proposed). Data and owner steps: [brand/governance/README.md](../../brand/governance/README.md), [docs/owner-checklist.md](docs/owner-checklist.md). Code: `src/governance/` (`lint.js` the rules, `propose.js` the only writer of proposals, `targets.js` the current state of what a proposal changes, `cli.js`).

A change to a profile, a framework principle, the BXQS rubric or the doctrine is a **proposal file** (`brand-proposal/1`, [schema](../../schemas/brand-proposal.schema.json)), in the DKP style: its own id, contributors, evidence classes and confidence, a changelog entry for the version it produces. It carries what changes, why, the evidence (each item one of the five classes), the affected products, the risk, the rollback, the precedence acknowledgement and a `history` of who moved it and when.

```
propose init     writes a draft from the target's current state (version, sha256, whether it is engagement-related); every text field is a TODO
lint-proposal    checks a proposal file(s); --check-ratified checks the ratified documents on disk against the ledger
propose submit   moves a draft to `proposed` if it passes the lint AS a proposal; writes nothing and exits 1 if not
```

### Who can do what

| Step | Who | How |
|---|---|---|
| `draft` | anyone, human or AI | `propose init`, then edit |
| `proposed` | anyone, human or AI | `propose submit` (the lint must pass) |
| `ratified` | **a human owner only** | edits the file in a reviewed merge: adds a human `approver`, `ratified_at` and a `ratified` history entry. **No command, flag or code path writes `ratified`**; a test reads `propose.js` and fails if the word appears |

`lint-proposal` checks the *form* of a ratification and refuses an AI actor, an approver marked AI or also listed as an AI contributor, ratification that skips `proposed`, a status that disagrees with the history, an approver on a proposal that is not ratified, and a ratified proposal whose approver is not the actor of its last history entry. It cannot prove who the approver is: that is CODEOWNERS and the owner's merge (ADR-0021). The owner approving their own proposal is a warning (`self-ratified`), not a refusal.

### What the lint refuses

A draft may be incomplete (gaps are warnings); from `proposed` on the same gaps are refusals. Precedence and AI-verification refusals apply to drafts too. Every refusal has a stable code, printed as `error [code] path: message`, and a test of its own.

| Code | Refused when |
|---|---|
| `schema` | the file does not match `brand-proposal.schema.json` (or `brand-changelog.schema.json`) |
| `ai-ratification` | an AI actor ratifies, the approver is not human, or is also an AI contributor or the AI author |
| `bad-transition`, `history-start`, `history-order`, `status-history-mismatch` | the history does not start at draft, goes back in time, skips `proposed`, moves after ratification, or ends at a status other than the proposal's |
| `approver-missing`, `ratified-at-missing`, `approver-mismatch`, `ratified-at-mismatch`, `premature-approver` | a ratified proposal lacks its approver or time, or they disagree with the history; or a draft or proposed one claims them |
| `unknown-target`, `target-exists`, `doctrine-new`, `new-has-base`, `new-in-place`, `from-version-missing`, `version-mismatch`, `stale-base`, `base-missing` | the target does not exist, already exists, was written against another version, or **changed since the proposal was written** (the recorded sha256 is stale) |
| `silent-edit` | a ratified target (or any released rubric) is edited in place instead of becoming a new version; also what `--check-ratified` reports for a ratified file whose content changed |
| `in-place-version`, `version-not-increased`, `changelog-version-mismatch` | the version arithmetic or the changelog entry does not match |
| `rubric-change-type-missing`, `rubric-change-type-misplaced`, `rubric-bump-mismatch`, `rubric-major-risk`, `rubric-version-exists` | a rubric change whose kind (`dimension_set_weight_or_cap` major, `checks_metrics_floors_policy` minor, `wording` patch) does not match its bump, or that re-releases a version |
| `placeholder`, `too-thin`, `missing-change-details` | text is a TODO or a label, or no field-by-field change is listed |
| `missing-evidence`, `evidence-class` | no evidence, or an item carries the wrong fields for its class |
| `unverified-citation`, `verification-record-missing`, `ai-verified-citation` | research is cited without a human verification record, or an AI "verified" it |
| `confidence-exceeds` | confidence is above what the evidence classes support (the same cap the profile validator applies) |
| `missing-affected-products` | no product is named (`ecosystem` names all) |
| `weakens-precedence`, `precedence-not-acknowledged`, `brand-outranks-domain` | the proposal weakens, ignores or reverses "safety, regulation, accessibility, security and functional correctness outrank brand" |
| `ethics-review-required`, `engagement-flag-mismatch` | a change to an engagement-related principle does not take the ethics gate, or misstates the flag |

### The ledger and `--check-ratified`

[`brand/governance/changelog.json`](../../brand/governance/changelog.json) is the versioned changelog (`created`, `amended`, `ratified`, `superseded`). Its `ratified` entries pin each ratified version's sha256, and only the owner adds one. `lint-proposal --check-ratified` compares every ratified profile, principle and doctrine, and every released rubric, with it. It reports `ledger-missing` (ratified, not recorded; the message prints the sha256 to record), `silent-edit` (content changed, status downgraded, version rolled back, or a released rubric modified), `ratified-file-removed`, `changelog-missing`, and entry faults (`ledger-hash-missing`, `approver-missing`, `ai-ratification`, `changelog-claim`, `changelog-duplicate`, `changelog-order`, `changelog-file`). The tests run it on the shipped data, so a pull request that edits a ratified file without the owner's entry fails the `tests` workflow. Today nothing is ratified and the ledger is empty.

## The Claude Skill

[`skill/dot-brand-experience/`](skill/dot-brand-experience/SKILL.md) is a thin interface. The source of truth stays here: the Skill holds no rubric, weights, check ids, hashes or scoring logic (a test fails if any rubric id appears in it), and calls only this CLI (`analyze`, `plan`, `verify`, `evidence assemble`, `score`, `propose`, `lint-proposal`, and the read commands for profiles, principles and the rubric reference). It states, for the model that follows it: advisory only; evidence honesty (the builder never earns points, an AI-only expert assessment is capped, observed and customer evidence is only ever a person's); dimensions 11 and 12 are not measured without real data; safety, regulation, accessibility, security and functional correctness outrank brand; never ratify; no simulated integration (no Dot.Memory, no Dot.Dopemine, no network). Reference files: `references/commands.md` (commands, flags, exit codes) and `references/report.md` (what a report must say).

**Install** (the owner's call; nothing runs it for you):

```
node skill/install.js --dry-run     # lists what it would write
node skill/install.js               # copies the skill to ~/.claude/skills/dot-brand-experience
node skill/install.js --dest <dir>  # somewhere else
```

It writes `SKILL.md`, `references/` and one extra file, `engine.path`, holding the path of this checkout's `src/cli.js`, so the Skill never searches the disk. It will not overwrite a file that differs unless `--force`, never deletes, ignores symlinks and makes no network call. Keep the checkout where it is; run the installer again after `git pull` or after moving the checkout. Start a new Claude Code session to load it.

`test/skill.test.js` checks that the frontmatter is valid (name equals the directory, description present and under 1,024 characters), that the skill is documents only, that every command and flag it shows exists in this CLI's usage, that none of the rubric appears in it, that each required statement is present, and the installer (idempotent, no overwrite, dry run, only under the given home).

## The assessment Action

[`.github/workflows/brand-assess.yml`](../../.github/workflows/brand-assess.yml) is a reusable workflow (`workflow_call`) that can also be dispatched by hand (`workflow_dispatch`). Nothing triggers it on its own.

```yaml
jobs:
  brand:
    uses: sakhilebhayi/Dot.Brain/.github/workflows/brand-assess.yml@<commit>
    with:
      brain_ref: <the same commit>        # the engine to run; the workflow cannot read its own ref
      profile: infodot                     # or empty, to use brand/profile.json in the product
      # repository: owner/name  ref: ...   # empty means the calling repository's default
      # reports_path: reports/axe          # committed tool reports the engine may read
      # fail_on_blockers: true             # default false: advisory
```

What it does: checks out Dot.Brain at `brain_ref` and the product (no credentials persisted), validates every input, resolves paths inside the product (a symlink that leaves the checkout is refused), then runs `analyze`, `evidence assemble` and `score` with the output **outside** the product checkout, writes a job summary, uploads `analysis.json`, `summary.md`, `evidence.json` and `score.json` as an artifact (`artifact_name`, default `brand-assessment`, 30 days), and exposes the outputs `state`, `evidenced_score` and `blockers`.

| It | Detail |
|---|---|
| fails only when | the engine fails (exit 2 or 3), or `fail_on_blockers` is true and the score report lists a blocker. Default: never gates |
| never | commits, pushes, opens a pull request, writes into the product checkout, declares or reads a secret, calls a URL of its own, or posts to Dot.Memory or Dot.Dopemine (no contract exists) |
| runs no external tool | axe, Lighthouse, the design detector and test runners are not run; the engine reads reports the product committed (`reports_path`). A check with no report is "not measured", counted as zero, listed |
| dates the evidence | by the commit's own time (or by the `recorded_at` of a person's file), so the same commit gives the same report |
| private repositories | uses the run's own token: call it from the private repository's own workflow. Assessing a private repository from elsewhere would need a read-only token the owner creates |
| inputs | reach the shell only as environment variables, validated by `ci/assess.js validate` before the product is read |

`ci/assess.js` is the workflow's helper (validate, prepare, summary, outputs, gate). It copies numbers from `score.json` as the engine wrote them and computes none.

`test/action.test.js` pins the workflow's text (triggers, permissions, no secrets, writes or network commands, action pins that match the other workflows, no input expanded into a script, actionlint when installed) and **runs the workflow's own shell steps** in a fake runner on the synthetic e2e product (a real git repository in a temporary directory): every step passes, the product is byte-for-byte unchanged, the report is outside it, the gate fails only when asked, the same commit gives the same bytes, an engine error fails the run, invalid inputs stop it before the product is read, and a profile symlinked out of the checkout is refused.

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

- Measure anything about how a person feels. `score` counts the evidence it is given; `analyze` produces automated evidence from files and reports, and no real product has been scored: the only scores in this repository are test fixtures marked as such.
- Run an external tool, edit the product repository, or call a network. It reads reports other tools wrote, and writes only where `--out` and `-o` say, never inside the checkout. The Action runs no tool either.
- Ratify a rubric. A rubric is ratified by the owner adding a record that names the hash, in a reviewed merge.
- Call an LLM, Dot.Memory or Dot.Dopemine, or any network.
- Ratify or sign anything. `propose` reaches `proposed` at most; no command writes `ratified`. Profiles and proposals are not DKP packs: they reuse DKP's field names and nothing else.
- Verify the recorded `commit` of a cited file (it reads a directory, not git history); the hash is the check.
- Prove who approved a ratified document. CODEOWNERS and the owner's merge do that (and only branch protection makes the review required: an owner setting, see [docs/owner-checklist.md](docs/owner-checklist.md)).

## Tests

`npm test` (zero dependencies, Node >= 22.5). Covers the schema interpreter, every rule and its
boundaries, extends resolution (cycles, overrides, non-negotiables, effective status), the example
product loaded from an arbitrary path and from temporary checkouts, drift (changed, missing, unreadable,
symlink escape, traversal), the CLI as a subprocess (exit codes, determinism, no environment value in
any output, read-only), and that everything shipped in `brand/` validates and stays honest (twelve
principles, none ratified, unknowns present, the Blupin claims policy, nothing private).

The governance tests (`test/governance.*.test.js`, `test/_gov_helpers.js`) give every lint refusal its own test (see the table above), the accepted shapes (a draft with gaps, an AI-drafted proposal ratified by a human), the ledger against ratified fixtures in temporary copies of `brand/`, and the commands as subprocesses: exit codes, that nothing on the command line can set `ratified`, that `propose submit` writes nothing when the lint refuses, never touches a ratified file and replaces only the file it was given, that output is deterministic and carries no environment value, and that the source has no clock, environment, network or process. `test/skill.test.js` and `test/action.test.js` are described above.

The scoring tests (`test/score.*.test.js`) cover: the rubric (weights sum to exactly 100, the owner's caps, shares,
the pinned hash, every way a rubric can be wrong, release and ratification records); the arithmetic on
hand-computed fixtures with each calculation written next to the expected number; the AI 50% rule, the builder
rule, minimum sample and cap boundaries; dimensions 11 and 12 and the prohibited-metric rejection; the confidence
table with its 50 and 49 point boundaries; blockers and precedence; the state machine at exactly 90 and just below,
at exactly the floor and just below, and the ratification requirement; compare across patch, minor and major;
frozen golden reports for seven synthetic scenarios; determinism and purity; and that every engine-written sentence
is a template.

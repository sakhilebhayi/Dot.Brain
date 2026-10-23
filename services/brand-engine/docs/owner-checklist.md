# Owner checklist: what only the owner can do

For the Brand Feeling Engine governance, Skill and Action ([ADR-0024](../../../adr/ADR-0024-brand-engine-governance-skill-action.md), proposed). An AI session cannot do any of these, and the engine is built so it cannot pretend to.

## 1. Ratify (or not)

Nothing is ratified today: every profile and principle is `draft`, the rubric is `proposed`, the ledger is empty.

- [ ] **Read and decide ADR-0021 to ADR-0024** (ADR-0023 and ADR-0024 are `proposed`).
- [ ] **Review the numbers in the rubric** (`brand/rubrics/bxqs-1.0.0.json`; listed in `brand/rubrics/README.md`) and ratify it by adding `brand/rubrics/bxqs-1.0.0.ratification.json`, or ask for a new version.
- [ ] **Ratify a profile or principle** (when you are ready): in a pull request you review, set `status: ratified`, your `approver` and `ratified_at` on the file, and add a `ratified` entry (with your id as approver and the file's sha256) plus a `created` or `amended` entry to `brand/governance/changelog.json`. `node services/brand-engine/src/cli.js lint-proposal --check-ratified` prints the sha256 it expects. To ratify a *proposal*, add your human `approver`, `ratified_at` and a `ratified` history entry to it; `lint-proposal <file>` checks the form.
- [ ] **Verify or drop the three unverified citations** (WCAG 2.2, Nielsen's heuristics, Sweller 1988). The lint refuses a proposal that relies on an unverified citation.

## 2. Make review a control, not a convention

- [ ] **Branch protection on `main`**: require a pull request, require review from Code Owners, and require the `tests` checks (including "every service is covered"). `.github/CODEOWNERS` routes `/brand/`, the rubric, the schemas, the governance code, the Skill, the CI helper, the assessment workflow, the ADRs and CODEOWNERS itself to you; without branch protection it only requests your review.
- [ ] Decide whether the self-ratified warning (you approving a proposal you wrote) should become a refusal.

## 3. Install the Skill (optional)

```
node services/brand-engine/skill/install.js --dry-run     # shows what it would write
node services/brand-engine/skill/install.js                # installs to ~/.claude/skills/dot-brand-experience
```

- [ ] Run it yourself, then start a new Claude Code session. Keep this Dot.Brain checkout where it is (the Skill runs the engine from it); run the installer again after moving it or after `git pull`. It refuses to overwrite a file you changed unless you pass `--force`.

## 4. Use the Action (optional)

- [ ] From a product repository: `uses: sakhilebhayi/Dot.Brain/.github/workflows/brand-assess.yml@<commit>` with `brain_ref: <the same commit>`. It is advisory unless you set `fail_on_blockers: true`.
- [ ] For a **private** product repository, call it from that repository's own workflow. To assess a private repository from elsewhere you would create a read-only token yourself; nothing here asks for one.
- [ ] Decide who may see the uploaded report: it is an artifact of the run and is as visible as the run is.

## 5. Evidence only people can supply

- [ ] Real sessions or customer feedback (at least five participants per result) for the dimensions no tool can measure. Without them no product can be `release_ready`, and dimensions 11 and 12 stay "not measured".

# brand/governance/

How changes to the brand knowledge are recorded and kept honest ([ADR-0024](../../adr/ADR-0024-brand-engine-governance-skill-action.md), proposed). Code: [services/brand-engine/src/governance/](../../services/brand-engine/README.md). Owner steps: [owner checklist](../../services/brand-engine/docs/owner-checklist.md).

```
changelog.json        the versioned changelog, and in its `ratified` entries the ledger that pins each ratified version's sha256
../proposals/         (absent until the first one) proposals, one file each: BRP-<date>-<slug>.proposal.json
```

## The changelog and the ledger

`changelog.json` ([schema](../../schemas/brand-changelog.schema.json)) is empty today because nothing is ratified. An entry has a `doc` (`profile:<id>`, `principle:BXP-NN` or `doctrine:brain.brand_experience`), a `version`, a `kind` and a short `summary`:

| kind | meaning |
|---|---|
| `created` / `amended` | the version exists; a proposal id may be named |
| `ratified` | the **owner** ratified exactly this version: names the human `approver` and the `sha256` of the file (the canonical hash of its sorted-key JSON for a profile or principle; the raw bytes for the doctrine) |
| `superseded` | a newer version replaced it |

`node services/brand-engine/src/cli.js lint-proposal --check-ratified` compares every ratified file on disk with the ledger and refuses: a ratified file whose content changed (a silent edit), one with no `ratified` entry, one downgraded or rolled back to an older version, one removed without a `superseded` entry, an AI approver, and a released rubric that no longer matches its pinned hash. The `tests` workflow runs it, so a pull request that edits a ratified file without the owner's entry fails.

Only the owner adds a `ratified` entry, in a reviewed merge. Nothing in the engine writes this file.

## Proposals

A proposal is a change request for a profile, principle, the rubric or the doctrine. Status is `draft`, `proposed` or `ratified`; an AI session or the engine can reach `proposed` and no further.

```
node services/brand-engine/src/cli.js propose init --target profile:infodot --author-id <id> --author-kind ai --author-name <name> --created-at <date-time> -o brand/proposals/<file>
# replace every TODO with real content and real evidence; then:
node services/brand-engine/src/cli.js lint-proposal brand/proposals/<file>
node services/brand-engine/src/cli.js propose submit brand/proposals/<file> --actor-id <id> --actor-kind ai --at <date-time> -o brand/proposals/<file>
```

The lint refuses, among others: an AI ratification, missing evidence, an unverified citation (or one an AI "verified"), confidence the evidence does not support, a stale base, an edit in place to a ratified document, a rubric change whose kind does not match its version bump, a proposal that weakens the precedence rule (safety, regulation, accessibility, security and functional correctness outrank brand), and an engagement-related principle without the ethics gate. Every code is listed in the engine README.

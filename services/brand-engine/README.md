# Dot.Brain — Brand Engine (foundation)

The registry and checker behind the Brand Feeling Engine (ADR:
[ADR-0021](../../adr/ADR-0021-brand-feeling-engine.md); doctrine:
[brain.brand_experience.md](../../brain.brand_experience.md); design:
[spec](../../docs/superpowers/specs/2026-10-23-brand-engine-foundation-design.md)).

It loads the reviewed data in [`brand/`](../../brand/README.md), validates it, resolves a profile's
`extends` chain, and checks that the files a profile cites have not drifted. It is **read-only,
offline, and has no LLM**. It decides nothing about a brand, ratifies nothing, and measures nothing
yet: the quality score, analysers, the Claude Skill and any Actions workflow are later increments.

## Run

```
node src/cli.js profile list
node src/cli.js profile show <id|file>
node src/cli.js profile validate [<id|file>]
node src/cli.js profile resolve <id|file>
node src/cli.js framework list
node src/cli.js framework show BXP-09
node src/cli.js drift <id|file> --root <checkout> [--repo <owner/name>]
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

- Rate, score or assess any product. No BXQS exists yet.
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

# Engine commands used by this skill

`ENGINE` is the path to `services/brand-engine/src/cli.js` in a Dot.Brain checkout. Every command is offline, reads no environment variable and no clock, and prints deterministic output. The engine reads reports; it never runs a tool and never writes inside the product checkout.

## Read

```
node "$ENGINE" profile list
node "$ENGINE" profile show <id|file>
node "$ENGINE" profile resolve <id|file>
node "$ENGINE" profile validate [<id|file>]
node "$ENGINE" framework list
node "$ENGINE" framework show <BXP-NN>
node "$ENGINE" rubric show
```

`<id>` is a Dot.Brain profile such as `infodot`. A value ending `.json`, or containing a path separator, is a product profile loaded from that path.

## The loop

```
node "$ENGINE" analyze <path> --profile <id|file> [--reports <dir>] [--out <dir>] [--repo <owner/name>] [--commit <sha>] [--themes light,dark] [--scope <path-prefix[,..]>]
node "$ENGINE" plan <analysis.json> [--out <dir>]
node "$ENGINE" verify --before <analysis.json> <path> [--profile <id|file>] [--reports <dir>] [--plan <plan.json>] [--claimed <ids|all>] [--scope <path-prefix[,..]>] [--out <dir>]
node "$ENGINE" evidence assemble --analysis <analysis.json> --built-by <id> [--assessments <file>] [--observed <file>] [--generated-at <date-time>] [--assistive-tech true|false] [-o <evidence.json>]
node "$ENGINE" score --evidence <evidence.json> --profile <id|file> [--built-by <id>]
```

The assessments file (`brand-assessments/2`, or the older `/1`) and the observed file (`brand-observed/1`) are written by people. Do not write one on a person's behalf. An assessment you write yourself is recorded as `kind: ai`, and the builder's own is recorded and earns nothing. In a `/2` file you may declare, for yourself only, that you are AI only, whether you are a fresh reviewer and whether you built the change; a declaration is recorded and never lifts a number, and the engine refuses one that contradicts `--built-by`. `--scope` limits the static checks to one surface of a repository (path prefixes inside it); report it, and use the same scope when you verify.

## Governance

```
node "$ENGINE" propose init --target <profile|principle|rubric|doctrine>:<id> [--new] --author-id <id> --author-kind ai --author-name <name> --created-at <date-time> [-o <proposal.json>]
node "$ENGINE" lint-proposal <proposal.json>
node "$ENGINE" propose submit <proposal.json> --actor-id <id> --actor-kind ai --at <date-time> [-o <proposal.json>]
```

`propose init` writes a draft full of TODO placeholders. Replace every one with real content and real evidence of the right class. A citation counts only after a human has verified it. `propose submit` moves a draft to `proposed` if the lint passes and writes nothing if it does not. No command sets `ratified`: the owner does that by hand.

## Exit codes

| Command | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| analyze, plan, evidence assemble | done | n/a | invalid input | refused (invalid brand data, modified rubric or document) |
| verify | improved or unchanged | regressions, or a claimed task that did not land | invalid input | refused or inconclusive |
| score | report produced | n/a | invalid input | refused |
| propose, lint-proposal | ok | the lint refused (nothing written) | invalid input | propose submit given a proposal that is not a draft |
| profile, framework, rubric | ok | findings | usage error | n/a |

Report any non-zero exit with the engine's own message. Do not retry with weaker flags to get a pass.

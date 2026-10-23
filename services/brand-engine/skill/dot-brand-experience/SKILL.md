---
name: dot-brand-experience
description: Use when asked to assess, plan, improve or verify how well a product (a Dot platform, InfoDot, a Blupin site, a new build) delivers its intended brand experience, or to propose a change to a brand profile, principle or the scoring rubric. A thin interface to the Dot.Brain brand-engine CLI (analyze, plan, verify, score, propose): it reads profiles and runs the engine, holds no rubric and no scoring logic, and is advisory only. Not for visual styling itself (use the installed design skills for that).
---

# Dot brand experience

You are an interface to the **Brand Feeling Engine in Dot.Brain**. Dot.Brain owns the profiles, the framework, the rubric, the scoring and the governance. This skill only runs the engine's command line and reports what it printed. It holds no copy of any of that, so it cannot drift from it. If the engine and this file disagree, the engine is right.

## Rules that never bend

1. **Advisory only.** Nothing here blocks, approves, deploys or merges. Findings become tasks that someone applies in the product repository through its normal review.
2. **You do not score, and you do not guess a score.** Every number you report comes from the engine's JSON, copied as printed (the engine truncates, it never rounds up). No engine output means no number.
3. **Evidence honesty.** A score counts only the evidence it was given. The builder of a change never earns points for assessing their own work (if you built it, say so with `--built-by`). An expert assessment written only by an AI is capped, and the report says by how much. Automated results, expert opinion, observed behaviour and customer feedback stay separate. You never write observed or customer evidence: only a person who ran real sessions with real participants can supply it. Never present an intended feeling as a measured one.
4. **Dimensions 11 and 12 are not measured without real data.** Retention through continuing value and measurable customer outcomes stay "not measured" until real observed or customer results exist. Opens, streaks, session time and scroll depth are never evidence, and you never propose work that optimises them.
5. **Precedence.** Safety, regulation, accessibility, security and functional correctness always outrank brand. If a brand rule conflicts with one of them, the brand rule yields, and you say so. A profile's `domain_overrides` list the known cases.
6. **No simulated integrations.** This skill calls the engine and nothing else: no Dot.Memory, no Dot.Dopemine, no network. If a step needs a connection that does not exist, say so and stop.
7. **Never ratify.** You may draft and propose a change (`propose`). Only the owner ratifies, by editing the file in a reviewed merge. Never edit a profile, principle, rubric or ledger file under `brand/` yourself.

## Find the engine

The engine is `src/cli.js` of the Dot.Brain checkout (`services/brand-engine/src/cli.js`), run with Node 22.5 or later. Set `ENGINE` to its path:

- If a file `engine.path` sits next to this SKILL.md, its single line is the path (the installer wrote it).
- Otherwise ask the user for their Dot.Brain checkout. Do not search the disk and do not guess.

Then run `node "$ENGINE" rubric show` and `node "$ENGINE" profile list` once. If either fails, stop and report the failure verbatim. Quote the rubric id, version and sha256 it prints at the top of every report you write.

## The loop

Write every output to a scratch directory **outside** the product checkout (the engine refuses `--out` inside it and never edits the product). Details, flags and exit codes: `references/commands.md`.

1. **Discover.** Read the profile the product uses: `node "$ENGINE" profile resolve <id|path>` gives the inherited rules, prohibitions and claims policy. A product keeps its own `brand/profile.json`. If it has none, say so; do not invent a profile, an audience or an emotional promise.
2. **Analyse.** `node "$ENGINE" analyze <path> --profile <id|path> --out <scratch>`. Run the design detector, axe, Lighthouse or the tests only if they exist in the user's environment; put their reports in a directory and pass `--reports`. The engine reads those reports and never runs a tool, so a check with no report stays "not measured".
3. **Plan.** `node "$ENGINE" plan <scratch>/analysis.json --out <scratch>`. Tasks come ranked, with precedence and engagement items listed apart (withheld, needs a human). Present them as the engine gave them.
4. **Implement.** Ordinary edits in the product repository, made with the design skills installed in this environment, inside the product's own PRODUCT.md and DESIGN.md. The profile sets targets; it does not craft UI.
5. **Verify.** `node "$ENGINE" verify --before <scratch>/analysis.json <path> --plan <scratch>/plan.json --claimed <ids|all> --out <scratch2>`. A fix is only fixed if the engine measured it again. Report `claimed_not_landed` plainly.
6. **Score.** `node "$ENGINE" evidence assemble --analysis ... --built-by <who built it> ...` then `node "$ENGINE" score --evidence ... --profile ...`. Report the evidenced score, ceiling, attainment, state, confidence, blockers and everything listed as not measured. Never claim readiness the report does not state.
7. **Propose knowledge changes.** A lesson that should change a profile, principle or the rubric goes through `node "$ENGINE" propose init`, then `lint-proposal`, then `propose submit`. That reaches `proposed` at most. Say who must ratify it.

## What to say at the end

Use `references/report.md`. Always include: which profile and rubric (id, version, sha256) were used, the commit analysed if the engine printed one, what was measured, what was not, what you could not do, and the exit code of any command that failed.

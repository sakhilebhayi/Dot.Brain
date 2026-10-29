---
title: ADR-0026 — InfoDot Knowledge Reputation and Tiers (R-13): Private, Rule-Derived Progress; No Trust Inference, No Leaderboard
version: 1.0.0
status: proposed
owners: [Chief Architect]
last-review: 2026-10-29
---

# ADR-0026 — InfoDot Knowledge Reputation and Tiers (R-13): Private, Rule-Derived Progress; No Trust Inference, No Leaderboard

Purpose: record what the first increment of R-13's reputation and tier engine does inside InfoDot, how it stays inside Dot.Brain's community and ethical-engagement policy, and the decisions only the owner can make before any tier has a visible effect.

> **Related documents:** [../brain.community.md](../brain.community.md) — reputation never sets trust · [../brain.dopemine.md](../brain.dopemine.md) — streaks and habit targets · [../brain.governance.md](../brain.governance.md) — ethics gate · [../brain.metrics.md](../brain.metrics.md) — registered metrics and anti-gaming · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) · [ADR-0020-infodot-knowledge-library.md](ADR-0020-infodot-knowledge-library.md) — contributions are scored by rules, never by author reputation

---

## Status

Proposed — 2026-10-29. Written by an AI session for the owner's review. Nothing here is ratified. The owner's R-13 brief (stored verbatim in the InfoDot docs) is the requirement. The code described is in InfoDot, **off by default** (`REPUTATION_ENABLED`), in pull requests awaiting review.

## Context

R-13 asks for four configurable tiers (Spark, Venture, Growth, Luminary) driven by a six-dimension reputation score (Learning, Contribution, Impact, Consistency, Expertise, Trust), with anti-manipulation controls, transparent progression, auditable recalculation and appeals. Dot.Brain's policy is prohibitive here: reputation may only feed a capped corroboration factor and never set trust (`brain.community.md`), leaderboards and streak targets are withheld or prohibited (`brain.dopemine.md`), and a feature needs a human-outcome target, a guard metric and a user-visible opt-out (`brain.governance.md`). Dot.Dopemine, Dot.Memory and Dot.Brain have no tier, score, badge or seminar concept and no collusion detection today.

## Decision

1. **Private progress only.** A person sees their own score, tier and the evidence behind each number. There is no leaderboard, no public tier, no comparison between people, and nothing about a tier appears on another person's pages.
2. **Rule-derived and explainable.** The score is a pure function of facts already in InfoDot (public, published, unhidden work; never help you gave yourself) under versioned rules in configuration. Every result carries the evidence behind each number; snapshots are append-only so a number can always be re-derived and an appeal checked.
3. **No trust inference.** The score is never used to rank content, weight a vote, skip moderation or decide who may do what. Reputation and organisation permissions are separate systems: a tier never grants a company role (InfoDot `TeamRoles`), a seat or an admin right.
4. **Manipulation controls in the first increment.** Dimension caps; work counted only when public and unhidden; no self-help; accepted answers from the same asker decay (1, 1/2, 1/4, then nothing); no streaks and no penalty for a gap (Consistency is small and only rewards weeks active in a window); a moderator hiding someone's work costs Trust. Two people accepting each other's answers count at half weight for that pair. **Not built:** detection of larger rings beyond that and the same-asker decay.
5. **Appeals.** A person can ask a moderator to check their score; the moderator sees the current evidence, the score is recalculated from the facts as they are, and the person sees the moderator's note.
6. **Thresholds are proposals.** Every weight, cap and tier threshold is a starting guess labelled as such in `config/reputation.php`; there is no real usage data. Changing one raises `version`; each snapshot stores the version used.
7. **No emission to Dopemine or Memory.** Neither has an event type for a tier, badge, seminar or attendance, and this increment adds none.

## Ethics-gate answers (for the owner's review)

- Human-outcome target: people getting practical business answers and being recognised for work other people found useful, not time spent or points chased.
- Guard metrics (proposed, to be registered per `brain.metrics.md`): share of contributions hidden or flagged among people near a tier threshold (a rise suggests gaming); share of accepted answers coming from one asker pair; appeal rate and the share of appeals that change the outcome.
- Visible and opt-out-able: the page is visible to its owner only. A per-person opt-out (deletes what is stored, stops the nightly run) and a download of one's own score data are built in InfoDot.
- Proxy-laundering table (`brain.dopemine.md`): Consistency is the "habit consistency" case, so it is user-declared-equivalent only if breaking a run carries no penalty; here it has none and a small cap.

## Decisions the owner must make (not decided here)

| # | Question | Options | Author's recommendation (not a decision) |
|---|---|---|---|
| D1 | Do tiers ever become public? | (a) never; (b) public tier badge; (c) public only for topic specialist badges | (c): specialist badges describe topic knowledge earned from verified solutions; an overall tier stays private. |
| D2 | Weights, caps and tier thresholds | Keep the starting proposals; set from data after weeks of use | Keep and review after four weeks of real data. |
| D3 | A per-person opt-out and a data export of one's own score history | Built; confirm the wording | Keep. |
| D4 | Ring detection | Build before any visible reward, or rely on same-asker decay | Build before any tier has a visible effect. |

## Consequences

- A person can see exactly why they are where they are and challenge it.
- A visible tier is impossible by accident: every surface that could show one is absent.
- Nothing measures real-world value yet; the numbers are guesses until there is data.

## Alternatives considered

- **Public tiers and a leaderboard.** Rejected: breaches `brain.community.md` and `brain.dopemine.md`.
- **Reputation weighting votes or trust.** Rejected: explicitly prohibited.
- **Free-form per-user adjustments by moderators.** Rejected: breaks determinism; an appeal is answered by recalculation and a note, and a wrong rule is fixed in the rules.

## Change log

- 2026-10-29: proposed.
- 2026-10-29: opt-out, own-data download and a reciprocal-acceptance discount built in InfoDot.

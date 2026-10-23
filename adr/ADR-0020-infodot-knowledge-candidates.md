---
title: ADR-0020 — InfoDot Knowledge Candidates: Rules-Only Recommendations, Never Awards
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-10-23
---

# ADR-0020 — InfoDot Knowledge Candidates: Rules-Only Recommendations, Never Awards

Purpose: record how Dot.Brain turns approved InfoDot contributions into candidates for a moderator-curated "Verified library" without bypassing InfoDot's scoring, moderation or points ledger, and the four decisions that keep it that way.

> **Related documents:** [../brain.community.md](../brain.community.md) §1, §3, §4 — the governance this implements · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — the envelope the decisions use · [ADR-0018-cross-platform-read-access.md](ADR-0018-cross-platform-read-access.md) — the precedent for a Brain-initiated pull · [ADR-0019-hourly-platform-collection.md](ADR-0019-hourly-platform-collection.md) — the service shape and Actions pattern reused · [../services/infodot-knowledge](../services/infodot-knowledge/README.md) — implementation · [../platforms/dot-infodot.md](../platforms/dot-infodot.md).

---

## Status

Accepted — 2026-10-23

## Context

InfoDot's public Q&A and Solutions hub accumulates answers worth reusing, and the owner wants a curated "Verified library" built from them. Contributions already pass through InfoDot's own scoring, moderation and points ledger (via Dot.Dopemine). Brain's role is narrow: notice which accepted contributions look reusable and put them in front of a moderator, with reasons. Two risks shape the design: that a recommender quietly becomes a second reward system (bypassing the ledger), and that "quality" collapses into popularity or reputation, the failure `brain.community.md` §1.3 and §4 exist to prevent.

## Decision

1. **The pull is HMAC-signed, not bearer.** Brain reads `GET /api/knowledge/candidates` from InfoDot with `X-InfoDot-Timestamp` and `X-InfoDot-Signature: sha256=HMAC-SHA256(secret, "{timestamp}.")` (a GET signs the empty body) inside a 300 second window, secret `KNOWLEDGE_SECRET_BRAIN`. This deviates from ADR-0018's bearer-token precedent (`token_env`, one scoped bearer per platform) because it is the scheme every other InfoDot server-to-server call already uses; adding a second scheme to one InfoDot endpoint would mean two ways to authenticate the same service. The same scheme and secret sign the read of Memory's outcomes endpoint. Writes to Dot.Memory keep the existing bearer `DOT_MEMORY_TOKEN`, because that is Memory's existing API. Both secrets are kept out of every log and every record.
2. **Rules only, no LLM.** The decision is a pure function (`scoreCandidate`) with a rationale list, in the style of `services/intelligence/src/reason.js`: independent corroboration, public status, a topic, a settling period, staleness. Every threshold is configuration and every rule has a test. A model would add nothing that a moderator needs explained and would make the decision unreproducible.
3. **Recommend, never award.** Brain emits decisions (`recommend_for_library`, `watch`, `do_not_recommend`) at autonomy level `recommend` at most, always `requires_approval`. It never emits award, points or badge events, never reads balances, and never writes to InfoDot. Adoption is a moderator action in the library; Memory reports it back as an outcome, which Brain uses only to grade its own rules (hit-rate per rule version, reported only from a minimum sample) and to stop re-offering declined items whose inputs have not materially changed.
4. **No person ranking.** `helpful_count` and `reuse_count` may add a bounded confidence nudge (hard-capped at 0.05 each, only for an already-corroborated contribution) and can never change a verdict. Author reputation, points and volume are not inputs. The author reference is not read by the scorer and is not forwarded to Memory. Nothing aggregates by author, nothing is scored per person, and no cohort claim is made (the n >= 20 floor is therefore never in play).

## Consequences

- Moderators receive recommendations with explanations; nothing enters the library unattended.
- Decisions are idempotent: `event_id` is a hash of the contribution reference, rule version, an inputs hash and the verdict. Unchanged input writes nothing new; a changed input writes a new decision. The verdict is in the hash because it also depends on the clock (an unchanged item that has now settled is a new decision). Popularity counts enter the hash only as far as they still move confidence, so a saturated count does not create churn.
- Brain stores nothing between runs. Dot.Memory is the store; a declined item is recognised from the `material` segment of the declined decision's `event_id`.
- Rule changes are visible: the rule version is part of every decision and every graded outcome.
- Quality is measured by moderator adoption of what was recommended, not by engagement.

## Alternatives considered

- **Bearer token for the InfoDot pull (ADR-0018 precedent).** Rejected: a second authentication scheme on one service.
- **An LLM to judge "usefulness".** Rejected: unreproducible, unexplainable to a moderator, and the signal that matters (independent acceptance and verification) is already structured.
- **Using helpful votes or author standing as a trust input.** Rejected by `brain.community.md` §1.3 and §4: a charismatic wrong contributor must not out-trust a correct unknown one.
- **Awarding points for recommended contributions from Brain.** Rejected: would bypass the ledger and turn a curation signal into a payout incentive.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-23 | InfoDot knowledge build | Initial decision record. |

## Open questions

- **Duplicate and contradiction detection is out of scope.** The scorer judges one contribution at a time; two items that say the same thing, or opposite things, can both be recommended. A moderator sees that; Brain does not claim to.
- **Independence is InfoDot's determination.** Brain trusts `accepted_by_independent` / `verified_by_independent` as given and cannot see who accepted or verified.
- **Scheduling.** The workflow is manual-only. The owner decides the cadence after reading a dry run; the pass reads the whole candidate set each time because settling and staleness are time-driven.
- **Memory's outcomes endpoint header names** are assumed to match InfoDot's (`X-InfoDot-Timestamp` / `X-InfoDot-Signature`); confirm when Memory's endpoint lands.

---
title: ADR-0027 — InfoDot Seminar Host Points (R-13): Hosts Earn, Attendees Never Do, Tiers Never Leave InfoDot
version: 1.0.0
status: proposed
owners: [Chief Architect]
last-review: 2026-10-29
---

# ADR-0027 — InfoDot Seminar Host Points (R-13): Hosts Earn, Attendees Never Do, Tiers Never Leave InfoDot

Purpose: record the owner's 2026-10-29 decision that seminars on InfoDot earn Dot Points for hosts only, the one-way event contract that carries it from InfoDot to Dot.Dopemine, why attendance is not rewarded, why no tier or reputation data crosses the boundary, the guard metrics proposed for it, and the decisions the owner still has to make.

> **Related documents:** [ADR-0026-infodot-knowledge-reputation-and-tiers.md](ADR-0026-infodot-knowledge-reputation-and-tiers.md) — tiers and reputation stay private inside InfoDot (decisions 3 and 7) · [ADR-0020-infodot-knowledge-candidates.md](ADR-0020-infodot-knowledge-candidates.md) — Brain recommends, never awards · [../brain.events.md](../brain.events.md) — event naming and the boundary rule · [../brain.dopemine.md](../brain.dopemine.md) — ethical engagement, proxy laundering · [../brain.community.md](../brain.community.md) §1.3 and §4 — reputation never sets trust · [../brain.governance.md](../brain.governance.md) §5 — the ethics gate · [../brain.metrics.md](../brain.metrics.md) §2, §4.8, §5 — metric standard, domain metrics, anti-gaming · [../platforms/dot-infodot.md](../platforms/dot-infodot.md)

---

## Status

Proposed — 2026-10-29. Written by an AI session for the owner's review. The decision in section "Decision" is the owner's (R-13 follow-up, 2026-10-29); everything else in this record is a proposal. The receiving side is built in Dot.Dopemine (pull request #48 on `Dot.Dopemine`, awaiting review, not merged, not deployed). The sending side is InfoDot work in a separate session. Dot.Brain writes no code for this and is not on the path of the event.

## Context

R-13 adds seminars to InfoDot (free and paid, hosted by members). The owner wants hosting to be recognised in Dot Points, the ledger Dot.Dopemine owns, using the same intake as every other InfoDot contribution (`POST /api/ingest/contributions`, HMAC-signed, idempotent by `event_id`). Three things shape the answer. Points are redeemable, so anything that pays is something people will try to manufacture. Attendance is trivially cheap to manufacture. And ADR-0026 has already decided that tiers and reputation are private progress inside InfoDot, with "no emission to Dopemine or Memory" (decision 7).

## Decision

Owner decision, 2026-10-29:

1. **Only the host earns.** A host earns Dot Points when a seminar they ran has finished with **at least 3 distinct attendees** and an **average attendee rating of 4.0 or more from at least 3 ratings**.
2. **Attending earns nothing.** There is no attendee event, no attendance reward and no bonus for attending many seminars.
3. **Tier and reputation changes never leave InfoDot.** There is no tier event type, no tier or reputation field in any contract, and Dot.Memory receives nothing about seminars or tiers.
4. **The receiving side enforces the rule.** Dot.Dopemine re-checks the thresholds itself and refuses an event that does not qualify (HTTP 422, a reason code, no ledger row). InfoDot is expected to send only qualifying seminars, but nothing trusts that.
5. **A cancelled seminar is never sent.** If an award was already made and the seminar is later cancelled or withdrawn, InfoDot sends the existing `infodot.contribution.reward_reversed` for the same reference.

## The event contract

The event is a **Dopemine contribution event**, the same family as `infodot.solution.verified` and `infodot.tutorial.approved`. It is not a Knowledge Pack and Brain does not see it.

| Item | Value |
|---|---|
| Wire name (as implemented) | `infodot.seminar.hosted` |
| Endpoint, auth, idempotency | `POST /api/ingest/contributions`; HMAC-SHA256 over `{timestamp}.{raw body}` with InfoDot's per-platform secret, 300 s window; `event_id` unique, a repeat is answered `200 {"status":"duplicate"}` |
| `contribution_ref` | `seminar:{id}` |
| `user_uuid` | the **host**, a pseudonymous uuid. The first event for the reference fixes the author |
| `visibility` / `tenant_uuid` | as for every contribution; a `company` seminar earns nothing |
| `facts.attendee_count` | integer >= 0 (distinct attendees) |
| `facts.rating_count` | integer >= 0 |
| `facts.average_rating` | number 0 to 5, at most one decimal |
| Anything else | **refused** (422 `seminar_unknown_field`), not ignored |

Privacy by construction: the body carries three counts and a pseudonymous host id. It carries **no attendee identity, no free text (no title, description or comment), no points, no per-person rating and no tier**. The ledger keeps the three counts for audit and nothing else about the seminar. The full field rules, example request and error codes are in `docs/points-contribution-events-api.md` in Dot.Dopemine.

**Naming.** [brain.events.md](../brain.events.md) §2 asks for `<domain>.<subject>_<past-tense-verb>`, which would give `infodot.seminar_hosted`. Dopemine's contribution family is dotted throughout (`infodot.answer.accepted`, `infodot.knowledge.adopted`, twelve types already handled by the intake) and the owner's brief for the receiving side fixed `infodot.seminar.hosted`. Decision proposed here: **keep the wire name `infodot.seminar.hosted` to stay consistent with its family**, and use `infodot.seminar_hosted` if the fact is ever republished as a DKP event, because §2 governs DKP events. Both match `event_name` in [schemas/event.schema.json](../schemas/event.schema.json) (`^[a-z0-9_.]+$`). Brain has no registry of Dopemine contribution events, and InfoDot has no platform manifest, so there is nothing to register today; [dot-infodot.md](../platforms/dot-infodot.md) §3 lists the event.

**Reward rule.** `seminar_hosted` v1, once per seminar, flat 10 points, daily cap 20 points per host, no approval step. These numbers are proposals; they are decision D1 below.

## Why attendance is not rewarded

- **Cheapest thing to fake.** A second account can attend for nothing. Points are redeemable, so paying for attendance creates a market for fake attendees, and the host's own friends and sock accounts would farm every seminar they run.
- **Goodhart.** "Attendance" is an engagement count. [brain.dopemine.md](../brain.dopemine.md) §3 treats a touchpoint without a comprehension change as an app open. Rewarding it would optimise showing up, not learning, and the guard metric would be measuring the thing being paid.
- **It pays the wrong person.** The value of a seminar is created by the host and shown by the rating the attendees give. Paying attendees too would pay twice for one outcome and give attendees a reason to rate generously.
- **The payout does not grow with the numbers.** The award is flat. It does not rise with attendees or rating, so there is no gradient pushing a host past the threshold, only a gate at it.

## Why tier data never leaves InfoDot

- **ADR-0026 already decided it** (decision 7: no emission to Dopemine or Memory; decision 3: no trust inference; decision 1: private progress, no public tier). A tier event would be the first crack in that.
- **Reputation must not turn into money.** [brain.community.md](../brain.community.md) §1.3 and §4: reputation never sets trust. The mirror case is equally bad: if a tier reached the points ledger it could weight rewards, and private progress would become a payout multiplier that rewards people for who they already are. Hosting eligibility here depends only on what happened in the seminar, never on the host's standing.
- **No loop.** The reverse also holds: Dopemine points and balances must not be an input to a tier. Points flow one way, InfoDot to Dopemine, and a tier never rides along.
- **Minimisation.** The fewer systems that hold anything about a person's standing, the smaller the POPIA surface and the fewer places an appeal has to reach.

## Ethics-gate answers ([brain.governance.md](../brain.governance.md) §5; for the owner's review)

1. **Human-outcome target.** Community contribution quality: practical knowledge shared in a form attendees independently rated useful. Not attendance, session time or points collected.
2. **Not a prohibited target.** No streak, no open or session count, no notification metric. Attendee count appears only as an eligibility floor, never as something to maximise, and the award is flat. Proxy trace: the strongest ancestor of the payout is the rating, which is an outcome signal, but a rating is gameable (see guards).
3. **Guard metrics declared.** The three below.
4. **Benefit goes to the user's goals.** The host is recognised for teaching; attendees get a seminar. Points are worth nothing in cash, cannot be transferred and lapse after 12 months.
5. **Visible and opt-out-able.** Visible: the award appears in the host's points history under a plain label. **Opt-out is not built**: hosting is voluntary, but there is no setting that says "do not give me points for hosting". See D4.

## Proposed guard metrics (not yet registered)

Per [brain.metrics.md](../brain.metrics.md) §1 a feature needs registered metrics before it ships, and per §4.8 domain metrics are registered in the platform's own file. These are proposals for the owner and for a follow-up that registers them in `platforms/dot-infodot.md`. They are computed **inside InfoDot** (the only place attendee identities exist) and only aggregates are ever reported. Per §5 each rate is paired with a volume.

| ID (proposed) | Type | Proposed target | Window | Why |
|---|---|---|---|---|
| `infodot.seminar_host_award_rate` paired with `infodot.seminar_attendee_repeat_concentration` | ratio, ratio (0-1) | reviewed together; flag a host whose award rate is above 0.9 while the three most frequent attendees hold more than 0.6 of attendance slots across at least 3 awarded seminars (threshold is a proposal) | monthly, per host with at least 3 awarded seminars | A host who is always "well rated" by the same small circle is the farming pattern. Either number alone is innocent. |
| `infodot.seminar_award_single_company_share` | ratio | reviewed, falling or at most 10% (proposal) | monthly | Awards where every attendee belongs to one company mean a team can pay itself. Informs whether independence needs to be required (D2). |
| `infodot.seminar_award_reversal_rate` | ratio | reviewed, at most 5% (proposal) | quarterly | High means events are sent too early or seminars are cancelled after payment; zero over a year with many awards would be its own finding. |

Volume pair for all three: number of seminars finished and number of awards in the same window. None of these metrics is a target to push; they are alarms.

## Residual risks (stated plainly)

- **A host with three accounts still qualifies.** Three distinct attendees and a 4.0 average from three ratings is a low bar. Dopemine cannot see who attended, so it cannot detect this. The guards above detect it after the fact; they do not prevent it. D2 is the real mitigation.
- **Rating pressure.** A 4.0 threshold rewards a host who asks for high ratings. Only the average and the count are sent, so Dopemine cannot see the distribution.
- **Pair decay does not apply.** Dopemine's reciprocal-pair decay works from an accepting or verifying actor, and this event has none.
- **The average can move after the event.** Dopemine pays once and does not recheck later ratings; only an explicit reversal takes points back, and only the unspent part.

## Decisions the owner must make (not decided here)

| # | Question | Options | Author's recommendation (not a decision) |
|---|---|---|---|
| D1 | Point amounts | Keep the proposal (10 points flat, daily cap 20, range 5-15 present in the rule but unused because the event carries no points); or tune | Keep for a first month, then tune from the guard metrics. An administrator can publish a new rule version without a deploy. |
| D2 | Make "distinct attendees" harder to fake | (a) as decided; (b) count only attendees outside the host's own team and who stayed for a minimum time; (c) also require attendees from at least 2 organisations | (b), enforced by InfoDot when it computes `attendee_count`, before any ring-detection exists. Dopemine's thresholds stay as the decision states. |
| D3 | Should Dot.Memory ever receive seminar participation? | Never; or only aggregate hosting outcomes | **Never.** Memory is long-term semantic memory; storing who attended what turns learning behaviour into a permanent record, no consumer needs it, and it would contradict ADR-0026 decision 7. |
| D4 | A per-person way to say "do not give me points for hosting" | None; or a setting in InfoDot that stops the event being sent | A setting, reusing the existing reputation opt-out wording, because the ethics checklist asks for opt-out. |
| D5 | The wire name | Keep `infodot.seminar.hosted`; or rename to `infodot.seminar_hosted` across the family | Keep, and revisit only if the family is ever published as DKP events. |
| D6 | When InfoDot sends | At finish; or after a fixed rating window (for example 7 days), once | After a fixed window, once, so the average is stable at the time of the single award. |
| D7 | Reversal window | Any time; or only within a stated period after payment | Any time, but say so on the host's page, since spent points cannot be taken back. |

## Consequences

- A host can see exactly why a seminar paid or did not (the 422 reason codes, and the points history label).
- Nobody earns for attending, and no tier or reputation figure exists outside InfoDot.
- The receiving thresholds can be changed by environment variable and the amount by a new rule version, neither needing a deploy of this repository.
- The fraud surface is reduced but not removed; the guards are alarms, not prevention.
- Nothing measures real-world value yet. The numbers are guesses until there is data.

## Alternatives considered

- **Reward attendees as well.** Rejected: see "Why attendance is not rewarded".
- **Scale the award with attendees or rating.** Rejected: creates a gradient to push, which invites inflation, and makes the host's payout depend on a count that cannot be verified here.
- **Send the host's tier so Dopemine can weight or restrict.** Rejected: see "Why tier data never leaves InfoDot".
- **Trust InfoDot's own eligibility check.** Rejected: a second check at the ledger costs one function and means a bug or a stolen secret on the sending side cannot mint points from malformed events.
- **Send every finished seminar and let Dopemine decide.** Rejected: it would send attendee counts of seminars that did not qualify, with no purpose.
- **Send seminar participation to Dot.Memory.** Rejected; see D3.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-10-29 | R-13 seminar session (AI) | Initial decision record (proposed). |

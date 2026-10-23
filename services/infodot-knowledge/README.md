# Dot.Brain — InfoDot Knowledge Candidates

Turns approved InfoDot contributions into **recommendations** for a
moderator-curated "Verified library" (ADR:
[ADR-0020](../../adr/ADR-0020-infodot-knowledge-candidates.md); governance:
[brain.community.md](../../brain.community.md) §1, §3, §4).

It **recommends**. It never awards points, never sees balances, never writes to
InfoDot, never ranks or names a person, and has no LLM. Scoring, moderation and
the points ledger are untouched; a moderator decides what enters the library.

```
pull candidates (InfoDot) -> read outcomes (Memory) -> score -> write decisions (Memory) -> grade
```

Both reads happen before any write, so a failed read leaves nothing half-done.
Brain stores nothing between runs; Dot.Memory is the store.

## Run

```
node src/cli.js run [--dry-run | --apply] [--since <ISO8601>] [--limit <1-100>] [--summary-file <path>]
```

| Flag | Meaning |
|---|---|
| `--dry-run` (default) | pull, read outcomes, score, grade; print counts; write nothing |
| `--apply` | also write one decision per candidate to Dot.Memory |
| `--since` | start of the pull (default: the epoch, i.e. every candidate; see below) |
| `--limit` | page size, 1 to 100 (default 100) |
| `--summary-file` | also write the counts as JSON (an optional artifact) |

Environment (all four required; **fail closed**: if any is unset or not an
`https` URL the CLI exits 1 naming the variable, having made no request):

| Variable | Use |
|---|---|
| `INFODOT_URL` | InfoDot base URL |
| `KNOWLEDGE_SECRET_BRAIN` | HMAC secret, must equal InfoDot's `KNOWLEDGE_SECRET_BRAIN` and Memory's |
| `DOT_MEMORY_URL` | Dot.Memory base URL |
| `DOT_MEMORY_TOKEN` | Dot.Memory Sanctum bearer token (decision writes) |

Exit: `0` run completed; `1` environment unset, a read failed (nothing was
written), or a write failed; `2` usage. Output is **counts only**: no
references, topics, URLs, authors, secrets or tokens. Every request has a
15 s timeout and at most 2 retries (network errors, 5xx, 403/408/429, with the
same WAF reasoning as the platform collector, ADR-0016); 401 and other 4xx fail
at once.

The default `--since` reads everything because verdicts are time-driven: an
item becomes "settled" or "stale" without anything about it changing, so a
windowed pull by update time would never see it again. Decisions are
idempotent, so a full pass is cheap to repeat. A pull is capped at 50 pages;
hitting the cap is reported as `TRUNCATED`.

Workflow: [`.github/workflows/infodot-knowledge.yml`](../../.github/workflows/infodot-knowledge.yml),
`workflow_dispatch` only (no schedule), input `dry_run` default `true`.

## Contracts assumed

1. **InfoDot candidates pull.** `GET {INFODOT_URL}/api/knowledge/candidates?since=<ISO8601>&limit=<n>`,
   signed: `X-InfoDot-Timestamp` (unix seconds) and
   `X-InfoDot-Signature: sha256=` + HMAC-SHA256(secret, `"{timestamp}."`) (a GET
   signs the empty body), 300 s window. Errors `{code, message}`. 200:
   `{items: [{contribution_ref, kind: "answer"|"solution", topics: [slug], url, author_uuid, created_at, edited_at|null, accepted_by_independent, accepted_at|null, verified_by_independent, verified_at|null, helpful_count, reuse_count, hidden: false, reversed: false}], next_since: ISO8601|null}`.
   Public items only, no bodies, no emails. Brain keeps only the fields scoring
   needs (drops `url`, `author_uuid` and anything else the moment it arrives)
   and follows `next_since` until it is `null`.
2. **Memory decision write.** `POST {DOT_MEMORY_URL}/api/intelligence/decisions`,
   bearer `DOT_MEMORY_TOKEN`, one per candidate, in the flat envelope
   `services/intelligence` already writes (plus the additive `verdict` and
   `evidence_refs` the schema calls for): `subject_type: infodot-contribution`,
   `subject_id` = the contribution reference, `signature: knowledge-candidate`,
   `verdict`, `confidence`, `detail.rationale[]`, `evidence_refs: [ref]`.
   Carries no content, no URL, no author, no email.
3. **Memory outcomes read.** `GET {DOT_MEMORY_URL}/api/knowledge-recommendations/outcomes?since=<ISO>`,
   HMAC-signed with the same scheme and secret (header names assumed identical
   to InfoDot's): `{items: [{contribution_ref, decision_event_id, outcome: "adopted"|"declined", decided_at}]}`.

## The rules (`src/rules.js`, `scoreCandidate(item, now, config)`)

A pure function returning `{verdict, confidence, rationale: [{rule, effect, detail}], rule_version}`.
Verdicts: `recommend_for_library`, `watch` (not yet, or no longer), `do_not_recommend`.

| Rule | Effect |
|---|---|
| input | Missing reference, unknown kind or unparseable date: `do_not_recommend` |
| public | `hidden` and `reversed` must both be literally `false`; anything else: `do_not_recommend` (confidence 0) |
| topics | At least one non-empty topic, else `do_not_recommend` |
| corroboration | `accepted_by_independent` or `verified_by_independent` must be literally `true` (InfoDot's determination that the accepter or verifier is not the author), else `do_not_recommend`. Both earn more confidence |
| settled | The earliest independent corroboration must be at least `settle_days` (default 14) old **and** no edit in the last `settle_days`; otherwise `watch`. Corroborated but undated: `watch`. Boundaries are inclusive (exactly 14 days is settled) |
| stale | Latest activity (created or edited) at least `stale_months` (default 18 calendar months) ago with `reuse_count` 0: `watch`. Inclusive |
| popularity | `helpful_count` / `reuse_count` add at most 0.04 each (hard maximum 0.05 each, whatever is configured), only if corroborated, and never change the verdict |
| reputation | Points, author standing and volume are not inputs. The author is not read |

Verdict = `do_not_recommend` if any block, else `watch` if any hold, else
`recommend_for_library`.

**Confidence** is earned like `reason.js`: base 0.4; +0.15 accepted, +0.2
verified, +0.05 if both, +0.03 if settled for twice `settle_days`, plus the
bounded popularity nudge; then every gate can only lower it: ceiling 0.9, `watch`
at most 0.6, excluded at most 0.2. It is how strongly the evidence supports
offering the item, not a probability; the hit-rate below is what shows whether
it is calibrated.

All thresholds are overridable (`resolveConfig`); nonsense throws.

**Out of scope, stated plainly:** contradiction and duplicate detection between
contributions. Two items saying the same, or opposite, things can both be
recommended. Brain also cannot verify independence itself, only trust InfoDot's flags.

## Idempotence

`event_id` = `kc:<material>:<rule_version>:<digest>`. `digest` hashes the
reference, rule version, an inputs hash and the verdict, so unchanged input
writes no new record and changed input writes a new decision. The verdict is
included because it also depends on the clock. Popularity counts enter the
inputs hash only as far as they still move confidence. `material` hashes the
contribution's own state (topics, corroboration, edits, visibility), which is
how a later run recognises "the very contribution a moderator declined,
unchanged" without storing anything: such an item is scored but not
re-recommended (`suppressed_declined`) until something material changes.

## Grading (`src/grade.js`)

`gradeOutcomes(decisions, outcomes)` reports, per rule version,
`adopted / (adopted + declined)` with the sample size. Below `min_sample`
(default 10) it reports **insufficient data**, never a number. One outcome per
decision (latest `decided_at`). The rule version is read from the `event_id`
itself, so past decisions are graded without anything stored locally.

## What it does not do

- Award, grant or revoke points, badges or reputation; read balances.
- Write to InfoDot, edit the library, or adopt anything itself.
- Score, rank, aggregate or name people; make cohort claims.
- Read or send contribution bodies, emails, URLs or author references.
- Detect duplicates or contradictions; run an LLM; run on a schedule (yet).

## Tests

`npm test` (zero dependencies, Node >= 22.5): every rule and its boundaries,
independence, hidden/reversed, popularity bounds, determinism, HMAC known
vectors (generated with `openssl`), the clients with injected `fetch` (timeouts,
401, retries, malformed responses, pagination), dry-run writes nothing,
fail-closed configuration, suppression of declined items, grading with small
samples, no secret in any output, and the CLI as a subprocess against a loopback
server.

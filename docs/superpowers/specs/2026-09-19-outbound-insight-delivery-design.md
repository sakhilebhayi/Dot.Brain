# Outbound Insight Delivery

## Context

Dot.Brain's product framing is shifting: it should operate as an always-on intelligence engine that *feeds* every Dot platform relevant, timely insights, not only a system platforms poll or that only writes back via Pull Request. Today's architecture has exactly one outbound path — the PR Generator (`brain.workflows.md` §6, `brain.architecture.md` §2–3) — and it exists only to propose structural changes (code, config, docs) that a platform reviews and merges or rejects. There is no path today for Brain to surface a purely informational, time-relevant finding to a platform in real time.

The `insight` DKP payload type already exists (`schemas/insight.schema.json`) but is inbound-only: platforms publish findings *into* Brain (e.g. `dkp:notify:ins:2026-06-10:0001` in `platforms/dot-notify.md` §4). Nothing today lets Brain emit an insight *outward*.

Separately, Dot.Notify already exists as "the shared last mile — delivery of alerts, digests, and messages on behalf of every other platform" (`platforms/dot-notify.md` §1), with consent, channel selection, precision-gating, and fatigue throttling already built and operating in production. ADR-0015 already rejected a comparable duplication (Dopemine as a general execution/delivery layer) on the same principle: don't let one platform re-implement another's job. A bespoke Brain-owned webhook/subscription system would repeat that mistake for delivery specifically.

ADR-0015 also already generalizes the "Brain decides, another platform executes" shape via the intelligence-loop envelope (`schemas/intelligence-loop.schema.json`): `observation → context → decision → action → outcome`, keyed by `loop_id`, with `action.executor_platform` naming who performs the effect and `outcome` closing the loop. This is proven in production by the Dot.Mines guardian (ADR-0014) and is the natural mechanism for "Brain asks Notify to deliver something," rather than a new bespoke channel.

**Ownership boundary is unchanged for structural work.** This design does not touch the PR Generator, does not grant Brain write access to any platform's files or data stores, and does not let Brain bypass a platform's own decision-making — it only adds a second, narrower outbound path for informational content, gated the same way (minus the one gate that doesn't apply).

## Goal

Ship the ability for Dot.Brain to emit an **Insight** — a time-relevant, evidence-backed, non-structural finding — to platforms through two surfaces:

1. **Pull** — a new read-only `GET /v1/insights/*` endpoint on Brain's existing Query API, for platforms and agents that want to ask directly.
2. **Push** — routed entirely through Dot.Notify's existing delivery infrastructure via the intelligence-loop envelope, for platforms that want real-time delivery without polling.

No new delivery infrastructure is built. No new JSON schema is introduced — `insight.schema.json` is reused as-is for the outbound direction. The only new component is the classification step that lets a W3 conclusion become an Insight candidate instead of only ever a Recommendation candidate.

## Non-goals

- External (non-ecosystem) data collection — out of scope per this iteration; internal Knowledge Pack data only, matching the existing ingestion boundary.
- Any write path from Brain into a platform's files or data stores. Insights are informational; only the PR Generator can propose a file change, and only for structural changes.
- A new notification channel, delivery UI, consent model, or throttling mechanism. All of that is Notify's existing job.
- Changing anything about how Recommendations or the PR Generator work.

## 1. Conclusion classification (`brain.workflows.md` §3–4)

W3 Reasoning today advances any conclusion at ≥ 0.80 confidence with a complete Why block to W4 as a Recommendation candidate (`brain.workflows.md` §4). This design adds one classification step at that same boundary:

- **Implies a platform-owned file/config/code change** → Recommendation candidate (existing path, unchanged).
- **Informational only, no implied change** → Insight candidate (new path), shaped per `insight.schema.json`: `statement`, `domain`, `evidence[]`, `method`, optional `scope` and `valid_until`.

A conclusion cannot be both. This mirrors the existing invariant that gates never edit content (`brain.workflows.md` §5) — classification is a routing decision made once, by the same reasoning agent that produced the conclusion, not re-litigated downstream.

## 2. Gates

Insight candidates pass through the same two gates as Recommendations, in the same order, with the same reject-don't-edit behavior (`brain.workflows.md` §5):

| Gate | Agent | Applies to Insights? | Rejects when |
|---|---|---|---|
| Ethics | Dopamine | Yes | Manipulative framing; optimizes a prohibited engagement metric |
| Security | Security | Yes | Classification leak; provenance chain crosses a privacy boundary |
| Governance | Governance | **No — skipped** | N/A — nothing is being applied to a platform, so there is no decision-rights question |

Governance is skipped specifically because an Insight is never merged, executed, or applied — the receiving platform's own logic decides what to do with it, same as it would with any other read-only query result. This keeps the exclusion narrow and explicit rather than a general "Insights are lower-risk" carve-out.

## 3. Delivery — pull

Gate-cleared Insights become queryable immediately via two new endpoints on the existing Query & Explanation API (`brain.api.md` §1–2):

| Endpoint | Consumer | Returns |
|---|---|---|
| `GET /v1/insights/{id}` | Platforms, agents | One Insight: statement, domain, evidence, `valid_until`, classification-filtered |
| `GET /v1/insights/search` | Platforms, agents | Insights matching domain/scope/platform filters, most-recent-first |

These follow the exact conventions already governing `/v1/query/*` (`brain.api.md` §2–3, §6): same auth (manifest-keyed Ed25519 for platforms, namespace-scoped for agents), same classification enforcement (`[restricted: n items]` markers, never a silent gap), same versioning/limits/error model. No new auth or filtering logic is introduced.

## 4. Delivery — push, routed through Dot.Notify

For a platform that wants an Insight delivered rather than polled, Brain emits an intelligence-loop envelope (`schemas/intelligence-loop.schema.json`, ADR-0015):

```json
{
  "loop_id": "<new loop id>",
  "stage": "action",
  "platform": "dot-brain",
  "subject": { "type": "insight", "id": "<insight id>" },
  "source": "insight-classification",
  "action": {
    "kind": "insight.deliver",
    "executor_platform": "dot-notify",
    "detail": {
      "insight_id": "<insight id>",
      "target_platform": "<platform id>",
      "scope": "<insight.scope, if present>"
    }
  },
  "occurred_at": "<timestamp>"
}
```

Dot.Notify receives this the same way it receives any executor assignment under the intelligence-loop contract — it owns channel selection, consent, and precision-gating (`platforms/dot-notify.md` §1, §6) exactly as it already does for every other platform's alerts. Brain does not choose the channel, does not touch consent state, and does not retry delivery itself; that is Notify's existing job, unchanged by this design.

**The outcome stage closes for free.** Notify already emits `messaging.delivery.acted/ignored` (`platforms/dot-notify.md` §3) for every delivery it makes. That event already carries what the intelligence-loop's `outcome` stage needs (`verdict`, `observed_at`) — no new outcome-tracking mechanism is built; Brain's loop-outcome recording (`brain.workflows.md` W6, `brain.learning.md`) consumes an event source it already understands.

## 5. What gets written or changed

| File | Change |
|---|---|
| `brain.workflows.md` | New classification step after W3 §4 (Recommendation vs Insight routing); gate table in §5 gains the Governance-skip row for Insights |
| `brain.api.md` | New `GET /v1/insights/{id}` and `GET /v1/insights/search` entries in §1 surface map and §2 endpoint table |
| `brain.architecture.md` | §2–3: "PR Generator — the ONLY outbound path" becomes "two outbound paths" (PR Generator for structural change; Notify-routed intelligence-loop action for Insights); component table gains the classification step |
| `adr/ADR-0017-outbound-insight-delivery.md` (new) | Records this decision, explicitly including the rejected bespoke-webhook alternative and why (duplicates Dot.Notify, contradicts the ADR-0015 precedent) |
| `platforms/dot-notify.md` | §5 "Intelligence Consumed" (or nearest equivalent) gains the new `insight.deliver` action-kind Notify now consumes from Brain |
| `README.md` | One-line addition under "What Dot.Brain IS" noting live Insight delivery alongside the existing Knowledge Pack ingestion and PR-based recommendations |

No changes to: `schemas/insight.schema.json` (reused as-is), the PR Generator, any gate agent's core logic beyond the one documented exclusion, Dot.Notify's own delivery/consent/throttling implementation.

## Error handling

- **Gate rejection** — same as today (`brain.workflows.md` §5): returned to the owning agent, ledger-recorded, two rejections of the same candidate escalate to a human. No new failure mode.
- **Pull endpoint failure** — same error model as existing `/v1/query/*` (`brain.api.md` §6): standard versioned error codes, no bespoke handling for Insights.
- **Notify delivery failure** — owned entirely by Notify's existing retry/failure semantics; Brain's only responsibility is recording the `action.execution_status` it receives back (`pending`/`succeeded`/`failed`), per the existing intelligence-loop contract. Brain does not retry Notify deliveries itself.
- **Stale Insight** — `valid_until` (already in `insight.schema.json`) governs pull-side staleness; an expired Insight is filtered from `search` results and returns `410`-equivalent on direct `GET /{id}`, consistent with how superseded knowledge is already handled elsewhere in the Query API (`brain.api.md` §2).

## Testing

- Classification step: unit-level coverage that a conclusion implying a file/config change routes to Recommendation, and one with no implied change routes to Insight — plus the boundary case (ambiguous conclusion) defaults to Recommendation (the stricter, human-reviewed path), never to Insight.
- Gate reuse: existing Ethics/Security gate test suites extended with Insight-shaped payloads; explicit test asserting Governance is never invoked for an Insight candidate.
- Pull endpoints: same contract-test pattern already used for `/v1/query/*` (auth, classification filtering, staleness), applied to `/v1/insights/*`.
- Push path: integration test asserting the emitted intelligence-loop envelope matches schema, `executor_platform` is always `dot-notify` for `insight.deliver`, and a synthetic `messaging.delivery.acted/ignored` event correctly closes the loop's `outcome` stage.

## Open questions

- Should a platform be able to opt out of push delivery entirely (pull-only), or is that already covered by Notify's existing consent model at the recipient level?
- Does `insight.deliver` need its own rate limit (mirroring the PR Generator's per-platform PR budget, `brain.workflows.md` §6), or is Notify's existing fatigue throttling (`platforms/dot-notify.md` §1) sufficient on its own?

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-19 | Brainstorming session | Initial design. |

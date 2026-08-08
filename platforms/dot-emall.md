---
title: Dot.Emall — Platform Knowledge
version: 1.2.0
status: active
owners: [Marketplace Platform Lead, Marketplace Agent, Registry Agent]
platform-id: dot-emall
dkp-version: 1.0.0
integration-status: publishing
last-review: 2026-08-01
---

# Dot.Emall

> **Platform-owned source:** [Dot.Emall's wiki.md](https://github.com/sakhilebhayi/Dot.Emall/blob/main/wiki.md) — the platform's own knowledge home. This document is Dot.Brain's ingested view; the wiki is authoritative for what the platform actually is.

## 1. Purpose & Business Domain

Marketplace platform — product listings, storefronts, ordering, and buyer–seller matching for the ecosystem's commerce, serving merchants (including Dot.Farms producers) and buyers. Owns the commerce *matching* domain: listings, demand signals, and order flow. Settlement belongs to Dot.Billing; seller finance to Dot.Finance; auctions to Dot.Auction (§6).

## 2. Entities Owned

| Entity | Graph node type | Natural key | Notes |
|---|---|---|---|
| Storefront | `entity:site` | `dot:node:commerce:store:<id>` | Tenant root (merchant) |
| Listing | `entity:asset` | store + SKU + version | Carries category taxonomy terms ([brain.semantic.md](../brain.semantic.md) topics) |
| Order | `entity:process` | order ID | Handoff key to Dot.Billing settlement |
| Demand signal | `observation` | category + region + window | Aggregate only — never individual buyer behavior |
| Fulfilment record | `outcome` | order ID | Ground truth for listing-timing verification |

## 3. Events Emitted

| Event | Trigger | Consumers | Frequency |
|---|---|---|---|
| `commerce.listing.published/expired` | Listing lifecycle | Brain ingestion, Dot.Analytics | ~10³/day |
| `commerce.order.placed/fulfilled` | Order flow | Brain, Dot.Billing (settlement trigger) | ~10³/day |
| `commerce.demand.window` | Aggregate demand summary per category/region | Brain | daily |
| `commerce.listing.unsold_expiry` | Listing expires unsold | Brain (negative outcome — file-drawer guard) | ~10²/day |

## 4. Knowledge Packs Published

> **Target contract below is still aspirational** (this codebase has no `observation`/`insight`/`outcome` pipeline — see [wiki.md](https://github.com/sakhilebhayi/Dot.Emall/blob/main/wiki.md) §7). **What's real as of 2026-08-02:** Dot.Emall cleared DKP onboarding step 1 — a real signing key, a manifest validated against `schemas/platform-manifest.schema.json`, a hand-run publish command, and one committed, independently-verified `incident_report` pack for the checkout stock-race finding. The ecosystem's second platform to do this, after Dot.Billing. See [os/19-Knowledge-Packs.md](../os/19-Knowledge-Packs.md) §4b and [Dot.Emall's wiki.md](https://github.com/sakhilebhayi/Dot.Emall/blob/main/wiki.md) §6 for the real account.

| Payload type | Cadence | Example pack ID |
|---|---|---|
| observation (demand/fulfilment aggregates) | daily batch | `dkp:emall:obs:2026-07-18:0061` |
| insight (demand-pattern findings) | per finding | `dkp:emall:ins:2026-04-12:0009` |
| outcome (listing-timing verification) | per verified recommendation | `dkp:emall:out:2026-07-29:0004` |
| incident (matching/pricing anomalies) | per incident | `dkp:emall:inc:2026-05-03:0001` |

## 5. Intelligence Consumed

| Recommendation type | Metric expected to move | Baseline |
|---|---|---|
| Listing-timing (the surface [dot-farms.md](dot-farms.md) §5 subscribes to from the producer side — Emall consumes the marketplace side: *when* to feature seasonal categories) | `commerce.listing_time_to_first_order_p50` | 2026 H1, per category |
| Category-demand forecasting | `commerce.unsold_expiry_rate` | 2026 H1 |
| Cross-platform supply matching (Farms harvest → regional demand) | `commerce.supply_demand_match_rate` | 2026 wet season |

The listing-timing recommendation is one finding, two PRs: Farms gets "list within N days of harvest," Emall gets "feature the category in window W" — same evidence chain, per-platform sovereignty, neither PR commits the other (the value-chain rule, [brain.business.md](../brain.business.md) §4).

## 6. Cross-Platform Relationships

```mermaid
flowchart LR
    F[Dot.Farms produce] -->|harvest-ready| E[Dot.Emall listing/matching]
    E -->|order placed| B[Dot.Billing settlement]
    B --> A[Dot.Analytics reporting]
    E <-->|auction-eligible listings| AU[Dot.Auction]
    E -->|merchant finance signals, aggregate| FI[Dot.Finance]
    E -->|engagement signals, constrained| D[Dot.Dopemine]
```

## 7. Tenancy Model

Tenant key = storefront ID; topics `commerce.<tenant>.<event>`. Buyer-side data is never tenant-published at individual resolution: demand signals aggregate at category × region × window with the n ≥ 20 distinct-buyer floor before any pack leaves the platform. Cross-merchant insights come only from published aggregates — merchant competitive data never leaks through the graph.

## 8. Dopamine Surface

Shares: listing completeness, fulfilment reliability (outcome-anchored merchant quality). Explicitly withheld: buyer browse-time, cart-abandonment nudge metrics, and repeat-visit streaks — buyer engagement mechanics are exactly the marketplace temptation dopemine §2's prohibited list names; the acid test ("would the buyer thank us?") gates every proposed signal.

## 9. Active Recommendations

Maintained by the Registry Agent. Current: seasonal category-featuring `open` (expiry 2026-08-25); listing-timing (wet-season produce) `verified` — see §13.

## 10. Incident History Summary

One incident pack (2026-05): category-taxonomy mismatch caused mispriced produce matching — F-KNOW class; lesson: listing category terms must resolve against the semantic taxonomy at publish time, now a validation rule. Consumed: aggregation-floor practice from community's intersection-attack rule.

## 11. Domain Metrics (registered per brain.metrics.md §4.8)

| ID | Type | Definition |
|---|---|---|
| `commerce.listing_time_to_first_order_p50` | duration | Listing published to first order, median per category |
| `commerce.unsold_expiry_rate` | ratio | Listings expiring unsold / listings published |
| `commerce.supply_demand_match_rate` | ratio | Harvest-window supply matched to demand windows / total seasonal supply |

## 12. Manifest (platform.dkp.json example)

```json
{
  "platform_id": "dot-emall",
  "dkp_version": "1.0.0",
  "signing_key_ref": "vault://keys/dot-emall/dkp-signing/v1",
  "publishes": ["observation", "insight", "outcome", "incident"],
  "subscribes": ["listing-timing", "category-demand-forecast", "supply-matching"],
  "schemas": { "knowledge-pack": "1.0.0", "metric": "1.0.0" },
  "tenancy": { "key": "storefront_id", "aggregation_floor": 20 }
}
```

## 13. Worked round-trip

The value chain's middle link, closed:

1. **Pack:** `dkp:emall:obs:2026-07-18:0061` — demand aggregates: fresh-produce category, Northern Cape region, 4 weeks; 3,200 orders across 87 storefronts (floor holds); signed, `ecosystem`.
2. **Validation → graph:** demand-window nodes; `OBSERVED_WITH` edge between Farms harvest-completion events and regional demand peaks at 0.71 (two seasons, corroborated by Farms' own packs — two independent sources, ×1.10).
3. **PR back (pair):** to Emall — feature fresh-produce category days 2–9 post-harvest-peak, confidence 0.82, impact `commerce.listing_time_to_first_order_p50` −25% predicted, guard `commerce.unsold_expiry_rate` flat; to Farms — the listing-timing PR its §5 subscribes to. Same chain, two sovereign decisions.
4. **Outcome:** `dkp:emall:out:2026-07-29:0004` verifies −31% time-to-first-order with unsold expiry flat — the chain's first two links now verified end-to-end; Billing's settlement-latency link is the next seam.

## Verified Infrastructure State (2026-08-07)

Confirmed directly against the real repo during the ecosystem-wide standardization + code-quality pass (full 26-platform summary: [brain.platforms.md](../brain.platforms.md) change log, v1.0.21):

- **Legal/branding/auth** — branded Markdown-mail theme, complete POPIA-aligned Privacy Policy/Terms/Cookie Policy naming **BluePin Inc**, guest auth pages restyled to match the welcome-page hero.
- **Laravel Boost** — `laravel/boost` ^2.5 installed; `.mcp.json`/`boost.json`/`CLAUDE.md` guideline block in place.
- **Code-quality pass** — Pint: 27 files reformatted, formatting-only. `composer audit`: patched 6 `league/commonmark` DoS advisories. `npm audit`: patched postcss path-traversal + shell-quote ReDoS (via concurrently). Full suite reconfirmed green (77 tests / 70 passed / 158 assertions) after every change.

## Autonomy Classification (brain.autonomy.md)

Per [brain.autonomy.md](../brain.autonomy.md) §2. Audited against the real codebase at `~/Dot/Dot.Emall` on 2026-08-08 — not aspirational.

### Level 1 — Autonomous

- **In-app order notification** — `App\Notifications\NewOrderNotification` (`app/Notifications/NewOrderNotification.php`), dispatched from `App\Http\Controllers\CartController::checkout()` (`app/Http/Controllers/CartController.php`) to each affected store owner once an order commits. Database channel only, synchronous, no owner approval anywhere in the path.
- **In-app review notification** — `App\Notifications\NewReviewNotification` (`app/Notifications/NewReviewNotification.php`), dispatched from `App\Http\Controllers\ReviewController::store()` the moment a buyer posts a review. Same pattern: routine, automatic, informational, no owner in the loop.
- **Checkout / order creation** — `CartController::checkout()` (`app/Http/Controllers/CartController.php`) runs the full cart→Order→OrderItem flow autonomously inside one DB transaction, including the `lockForUpdate()` + WHERE-guarded atomic stock decrement that closed the stock-race incident (`app/Console/Commands/PublishDkpIncidentPack.php` documents the fix). No human approves any individual checkout. This is routine commerce processing, not a financial commitment by the platform operator — actual settlement/fund movement is explicitly out of this codebase's scope (owned by Dot.Billing per §1/§6 above); Emall's checkout only ever creates order records and decrements stock.

### Level 2 — Escalate

None found. Checked: `routes/web.php`, `routes/api.php`, `app/Http/Controllers/*`, `app/Console/Commands/PublishDkpIncidentPack.php`, `app/Events/OrderPlaced.php`, `app/Policies/*`. Nothing in the codebase follows the Level 2 shape (system analyses/prepares an action, then blocks on human approval before executing). The one place that looks adjacent — `dkp:publish-incident` — is not system-initiated analysis awaiting approval; it is a command a human runs end-to-end by hand (see Level 3 below), so it doesn't fit the Level 2 pattern of an automated proposal gated by a human gate.

### Level 3 — Human Control

- **DKP incident-pack publishing** — `php artisan dkp:publish-incident`, implemented in `app/Console/Commands/PublishDkpIncidentPack.php`. The class's own docblock states it directly: "one hand-run script, not a pipeline" that "does not transmit anywhere" — a human runs it, supplies `--contributor-email`/`--contributor-name`, and reads the signed JSON it writes to `storage/app/dkp/packs/`. No scheduler entry exists for it (`app/Console/Kernel.php` / `routes/console.php` register only the stock Laravel `inspire` command).
- **Signing-key custody** — `config/dkp.php` points at `storage/app/private/dkp-signing.key` (present, gitignored per `storage/app/private/.gitignore`), an Ed25519 signing seed a human must generate, store, and rotate; there is no automated key-management or rotation code anywhere in the repo. Textbook "security credential ownership" per brain.autonomy.md §2.
- **Dependency/security patching** — the platform doc's own Verified Infrastructure State (2026-08-07) records `composer audit` and `npm audit` fixes (6 `league/commonmark` advisories, postcss/shell-quote) as hand-run during a manual pass, not CI-gated. Confirmed: no `.github/workflows/`, no CI config of any kind exists in the repo (`find .github -type f` and repo-wide `*.yml`/`*.yaml` search both return nothing outside `vendor/`/`node_modules/`).
- **Deploys and migrations** — `composer.json`'s `setup` script runs `artisan migrate --force` and `npm run build` directly; there is no pipeline that runs this automatically on push or merge. Every release step is triggered by a human at a terminal.
- **Middleware/auth configuration** — `bootstrap/app.php`'s `withMiddleware()` closure is empty; access control lives entirely in hand-written route groups (`routes/web.php`: `auth:sanctum`, `verified`) and hand-written policies (`app/Policies/OrderPolicy.php`, `app/Policies/ReviewPolicy.php`, `app/Policies/TeamPolicy.php`). Changing who can see what is a manual code change reviewed and merged by a human, not a runtime-configurable or self-adjusting system.

### Gap summary

Every real autonomous behavior in this codebase (notifications, checkout) is a synchronous side effect of a single HTTP request, not an independent background process — there is no scheduled command (`app/Console/Kernel.php` registers nothing but the default `inspire`), no queued job (`app/Jobs/` doesn't exist), and no CI/CD. The first real Level 1 *operator-relief* process (as opposed to routine request-time automation) would need an actual scheduler entry or queue worker doing something today's human does by hand — the most obvious candidate is automating `dkp:publish-incident` into a triggered/queued job so future incident packs don't require a human to run the artisan command and read the file manually.

## Change Log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-08-01 | Platform Integrator (prompt 05, AI) | Initial integration package: matching-domain ownership, entities, aggregate-only demand signals, paired listing-timing PR surface, buyer-engagement withholdings, 3 domain metrics, manifest, value-chain round-trip |
| 1.0.1 | 2026-08-01 | Repository Reviewer (prompt 07, AI) | Auction-handoff OQ struck (resolved by dot-auction.md) |
| 1.0.2 | 2026-08-01 | DKP Architect (prompt 02, AI) | Taxonomy OQ struck (schemas/taxonomy.json published) |

| 1.0.3 | 2026-08-01 | Repository Steward Agent | Linked to Dot.Emall's own wiki.md (platform repo) as the platform-owned source of truth |
| 1.1.0 | 2026-08-02 | Sakhile Bhayi | §4 flagged: the target contract below is still aspirational, but Dot.Emall has now cleared real DKP onboarding step 1 (key, manifest, publish script, one verified `incident_report` pack) — the ecosystem's second platform to do so, see os/19-Knowledge-Packs.md §4b. |
| 1.2.0 | 2026-08-08 | Platform Autonomy Classification sub-project | Added Autonomy Classification section per brain.autonomy.md §2 |

## Open Questions

| Question | Owner → Approver |
|---|---|
| ~~Listing category terms now validate against the semantic taxonomy — does Emall need the machine-readable taxonomy export (brain.semantic.md's schemas/taxonomy.json open question) more urgently than other platforms?~~ **Resolved 2026-08-01:** [schemas/taxonomy.json](../schemas/taxonomy.json) published; `commerce.listing.category` frozen | Marketplace Agent → Chief Architect |
| ~~Auction-eligible listing handoff to Dot.Auction: entity ownership during an active auction — Emall's listing or Auction's lot?~~ **Resolved 2026-08-01** by [dot-auction.md](dot-auction.md): exclusive ownership transfer to the lot; `unsold_expiry` clock paused | Marketplace Agent → Chief Knowledge Engineer |

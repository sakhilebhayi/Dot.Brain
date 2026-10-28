# ux-interactions

The versioned event contract for user interaction intelligence (R-12). This package is the contract and nothing else: a taxonomy, a validator that refuses anything outside it or anything that looks personal, and batch handling with idempotency keys. It has no pipeline, no storage and no network, and no product emits these events yet. Where the events are collected, stored and read is open (ADR-0025, proposed).

```
npm test        # node --test, no dependencies, Node >= 22.5
```

```js
import { validateEvent, validateBatch, idempotencyKey } from './src/index.js';

const { ok, reasons } = validateEvent(event);   // reasons: [{ path, code }], never the offending value
const batch = validateBatch(events);            // accepted [{ key, event }], rejected [{ index, reasons }], duplicates
```

## What an event can hold

Only fields the taxonomy names (`additionalProperties: false` everywhere): `event_id` (uuid), `occurred_at` (UTC, within 7 days past and 5 minutes future), `product`, optional `tenant` (uuid), a pseudonymous `session` (`ps_` + hex), `type` and `name`, a `route` **template** (no query string, no ids), `status`, and per-type blocks: `workflow {id, step, seq}`, `perf` (milliseconds), `error {category, code}`, `counts`, `flags`, plus `consent.basis`. Search events carry the query **length** and result count, never the query. Which blocks, counts and statuses a type may carry is in `src/taxonomy.js`.

## What it refuses

- Unknown fields and unknown types; blocks, counts or statuses the type does not allow.
- Any string that looks like an email, a token or JWT, a URL or query string, a phone number, a payment card number (Luhn) or a South African ID number (date and Luhn). The rejection names the path and a code (`forbidden_email`, ...) and never repeats the value.
- Events over 2 KB and batches over 50 events.

The detectors are a net, not the main control. The main control is that there is no field in which free text can go.

## Files

| File | Purpose |
|---|---|
| `src/taxonomy.js` | Version, event types and what each may carry, limits |
| `src/validate.js` | `validateEvent`, `validateBatch`, `idempotencyKey` |
| `src/forbidden.js` | Value detectors, reason codes only |
| `../../schemas/ux-interaction-event.schema.json` | JSON Schema for the shape; a test pins it to the taxonomy so the two cannot drift |
| `../../adr/ADR-0025-ux-interaction-intelligence.md` | The decision record, with the open owner decisions |

Adding an event type, field or enum value is a schema version change.

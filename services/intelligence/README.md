# Dot.Brain — Intelligence Loop Client

Dot.Brain's side of the ecosystem intelligence loop
([ADR-0015](../../adr/ADR-0015-three-platform-intelligence-loop.md),
contract: [`schemas/intelligence-loop.schema.json`](../../schemas/intelligence-loop.schema.json)).

**Brain thinks. It does not store (that is Dot.Memory) and does not act
(that is the executor platform).**

```text
   Dot.Memory                Dot.Brain                 Executor
  "what do we know?"  ──►  reason about it  ──►  carry the action out
        ▲                        │                        │
        └──── remember the decision, the action, and what came of it ◄──┘
```

## One turn of the loop

```js
import { memoryConfig } from './src/memory-client.js';
import { runLoop } from './src/loop.js';

const result = await runLoop({
  subject: { type: 'customer', id: '42', label: 'Acme Mining' },
  proposal: {
    action_kind: 'retention_followup',
    risk: 0.2,
    recommendation: 'Follow up personally about the unresolved support issue.',
    executor_platform: 'dot-dopemine',
    mechanic_ref: 'mech:milestone-recognition',
  },
  policy: { autonomy_ceiling: 'recommend' },
  cfg: memoryConfig(),
  execute: deployViaDopemine,   // omit to decide without acting
});
```

`runLoop` asks Memory what is known, reasons about it, records the
decision (including its reasoning), and — only if the gates allow —
hands the action to the executor and records what came of it.

## How a decision is reached

`reason()` is a pure function, deliberately: every branch is a claim about
when a machine may act unattended, and those belong somewhere a person can
read and a test can pin. It generalizes the guardian's `decide.js`, which
has run these same gates against Dot.Mines production since 2026-08-25.

Confidence is **earned from recorded outcomes for that kind of action**,
never from how sensible a recommendation sounds:

| Evidence | Effect |
| --- | --- |
| Nothing known about the subject | confidence 0.3 — any conclusion is a guess |
| Fewer than 2 graded attempts | no bonus — one result is an anecdote, not a rate |
| ≥ 80% of graded attempts improved | +0.3 |
| ≥ 50% | +0.1 |
| Below 50% | −0.2 |
| Any attempt made things worse | −0.1 |

Gates can only ever **weaken** the outcome, so the strictest applicable
constraint decides:

- confidence below `min_confidence` (0.6) → recommend only
- risk above `max_risk` (0.4) → a person signs it off
- the operator's `autonomy_ceiling` always wins, however good the evidence
- no action proposed → nothing to authorise

**Memory being unreachable is not an empty history.** A failed context
fetch drops the decision to `observe`, because acting confidently on
evidence that was never actually read is the worst failure this system
could have.

## Environment

```
DOT_MEMORY_URL=https://memory.infodot.co.za
DOT_MEMORY_TOKEN=…    # Sanctum service token
```

## Tests

```bash
npm test    # 15 tests: every reasoning branch, plus the loop end to end
```

# Revenue Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `services/revenue-intelligence` — opportunity-detection heuristics over a `services/revenue-reader` poll result, feeding the existing Insight Delivery pipeline shape (gates, Dot.Memory recording, Notify-routed delivery scoped to admin recipients) — per `docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md`.

**Architecture:** A new standalone service, `services/revenue-intelligence/`, following the exact conventions already used by `services/insight-delivery` and `services/revenue-reader` (ES modules, `node --test`, injectable `fetch`/env, self-contained — no cross-service imports). It provides: (1) pure opportunity-detection heuristics that turn a Revenue Reader poll result into `insight.schema.json`-shaped candidates, (2) the same Ethics/Security gates, Dot.Memory client, and Notify-routed delivery function as `services/insight-delivery` (duplicated per this repo's established convention, with delivery always scoped `admin`), and (3) a pipeline that ties detection → gating → recording → delivery together, accounting for every candidate. One doc update records the new component; no new ADR (design spec Context — this introduces no new trust boundary).

**Tech Stack:** Node.js ≥ 22.5 (ESM), built-in `node:test` + `node:assert/strict` (matches every sibling service), no external dependencies.

## Global Constraints

- `detectOpportunities` never throws on well-formed-but-boring input — an empty or all-non-matching `signals` array returns `[]` (design spec §1, Error handling).
- A generated insight's `classification` is always inherited from the poll result's own `classification`, never upgraded or invented (design spec §1).
- A generated insight's `evidence` references only the triggering signal's key, the platform, and `generated_at` — never the full raw signals array (design spec §1).
- `deliverInsight` always delivers with `audience: 'admin'` — this is not a caller-supplied parameter in this service (design spec §2, distinct from `services/insight-delivery`'s version where `scope` is passed through). `audience` is a delivery-time Notify parameter, deliberately distinct from the Insight's own `scope` field (which `opportunities.js` sets to the enrolling platform, per `insight.schema.json`'s actual meaning).
- No cross-service imports: `gates.js`, `memory-client.js`, and `deliver.js` are this service's own files, matching the shape of `services/insight-delivery`'s files of the same name, not imports of them (design spec §2, Global Constraints of the design: "every service owns its own small clients").
- No platform enrollment exists yet and none is created by this plan — all tests exercise the pipeline against a plain JavaScript object shaped like a Revenue Reader poll result, never a real poll (design spec Non-goals).
- No new ADR, no changes to `services/insight-delivery`, `services/revenue-reader`, or their existing files.

---

## File Structure

```
services/revenue-intelligence/
  package.json
  README.md
  src/
    opportunities.js   # detectOpportunities, CHURN_RATE_THRESHOLD
    gates.js            # runEthicsGate, runSecurityGate, PROHIBITED_TARGET_METRICS (same shape as insight-delivery's)
    memory-client.js    # memoryConfig, recordInsight, recordAction, recordOutcome (same shape as insight-delivery's)
    deliver.js          # deliverInsight, recordDeliveryOutcome (scope hardcoded to 'admin')
    pipeline.js          # runPipeline
    cli.js               # bin entry point: detect
  test/
    opportunities.test.js
    gates.test.js
    memory-client.test.js
    deliver.test.js
    pipeline.test.js

brain.architecture.md    # modified: new component, new diagram node/edge
```

---

### Task 1: Opportunity detection

**Files:**
- Create: `services/revenue-intelligence/src/opportunities.js`
- Test: `services/revenue-intelligence/test/opportunities.test.js`

**Interfaces:**
- Produces:
  - `CHURN_RATE_THRESHOLD: number` — `0.05`
  - `detectOpportunities(pollResult: {platform: string, generated_at: string, classification: string, signals: object[]}) => Array<{statement: string, domain: 'revenue', method: string, evidence: Array<{kind: 'external', reference: string}>, scope: string, 'x-classification': string, valid_until: string}>` (`scope` is the enrolling platform; `audience: 'admin'` is a separate, delivery-time parameter set in `deliver.js`, not part of the Insight itself; `classification` is carried as `x-classification` since `insight.schema.json` is `additionalProperties: false`)

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-intelligence/test/opportunities.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectOpportunities, CHURN_RATE_THRESHOLD } from '../src/opportunities.js';

const BASE = {
  platform: 'dot-billing',
  generated_at: '2026-09-23T10:00:00.000Z',
  classification: 'restricted',
};

test('detects MRR decline when trend is down', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /MRR is trending down for dot-billing/);
  assert.equal(result[0].domain, 'revenue');
  assert.equal(result[0].scope, 'admin');
  assert.equal(result[0].classification, 'restricted');
});

test('does not flag MRR when trend is up', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'up' }] });
  assert.equal(result.length, 0);
});

test('detects a high churn rate above the threshold', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.churn_rate', value: 0.08 }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /Churn rate \(0\.08\) exceeds/);
});

test('does not flag churn rate at or below the threshold', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.churn_rate', value: CHURN_RATE_THRESHOLD }] });
  assert.equal(result.length, 0);
});

test('detects a rising payout delay', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'finance.payout_delay_p50', value: 3, trend: 'up' }] });
  assert.equal(result.length, 1);
  assert.match(result[0].statement, /Payout delay is trending up/);
});

test('does not flag payout delay when trend is down', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'finance.payout_delay_p50', value: 3, trend: 'down' }] });
  assert.equal(result.length, 0);
});

test('an unrecognized signal key produces no insight', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.arr', value: 500000 }] });
  assert.equal(result.length, 0);
});

test('an empty signals array produces no insights', () => {
  const result = detectOpportunities({ ...BASE, signals: [] });
  assert.equal(result.length, 0);
});

test('multiple matching signals each produce their own insight', () => {
  const result = detectOpportunities({
    ...BASE,
    signals: [
      { key: 'revenue.mrr', value: 1000, trend: 'down' },
      { key: 'revenue.churn_rate', value: 0.1 },
    ],
  });
  assert.equal(result.length, 2);
});

test('evidence references the triggering signal, platform, and generated_at', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.deepEqual(result[0].evidence, [{ kind: 'metric', reference: 'dot-billing:revenue.mrr@2026-09-23T10:00:00.000Z' }]);
});

test('valid_until is 24 hours after generated_at', () => {
  const result = detectOpportunities({ ...BASE, signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }] });
  assert.equal(result[0].valid_until, '2026-09-24T10:00:00.000Z');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-intelligence && node --test test/opportunities.test.js`
Expected: FAIL — `Cannot find module '../src/opportunities.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-intelligence/src/opportunities.js

/**
 * Opportunity-detection heuristics over a Revenue Reader poll result
 * (design spec §1). Pure and total: an empty or all-non-matching
 * signals array returns [], never throws.
 */
export const CHURN_RATE_THRESHOLD = 0.05;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * @param {{platform: string, generated_at: string, classification: string, signals: object[]}} pollResult
 * @returns {object[]}
 */
export function detectOpportunities(pollResult) {
  const { platform, generated_at, classification, signals } = pollResult;
  const insights = [];

  for (const signal of signals) {
    if (signal.key === 'revenue.mrr' && signal.trend === 'down') {
      insights.push(buildInsight({
        statement: `MRR is trending down for ${platform}.`,
        platform, generated_at, classification, signal,
      }));
    } else if (signal.key === 'revenue.churn_rate' && signal.value > CHURN_RATE_THRESHOLD) {
      insights.push(buildInsight({
        statement: `Churn rate (${signal.value}) exceeds the ${CHURN_RATE_THRESHOLD * 100}% watch threshold for ${platform}.`,
        platform, generated_at, classification, signal,
      }));
    } else if (signal.key === 'finance.payout_delay_p50' && signal.trend === 'up') {
      insights.push(buildInsight({
        statement: `Payout delay is trending up for ${platform} -- an operational risk to revenue.`,
        platform, generated_at, classification, signal,
      }));
    }
  }

  return insights;
}

function buildInsight({ statement, platform, generated_at, classification, signal }) {
  return {
    statement,
    domain: 'revenue',
    method: 'threshold-rule',
    evidence: [{ kind: 'metric', reference: `${platform}:${signal.key}@${generated_at}` }],
    scope: 'admin',
    classification,
    valid_until: new Date(new Date(generated_at).getTime() + ONE_DAY_MS).toISOString(),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-intelligence && node --test test/opportunities.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-intelligence/src/opportunities.js services/revenue-intelligence/test/opportunities.test.js
git commit -m "feat(revenue-intelligence): add opportunity-detection heuristics"
```

---

### Task 2: Ethics and Security gates

**Files:**
- Create: `services/revenue-intelligence/src/gates.js`
- Test: `services/revenue-intelligence/test/gates.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces (same shape as `services/insight-delivery/src/gates.js`):
  - `PROHIBITED_TARGET_METRICS: string[]`
  - `runEthicsGate(insight: {targetMetric?: string}) => {passed: boolean, reason?: string}`
  - `runSecurityGate(insight: {classification?: 'public'|'restricted'}, targetPlatformClearance: Array<'public'|'restricted'>) => {passed: boolean, reason?: string}`

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-intelligence/test/gates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEthicsGate, runSecurityGate, PROHIBITED_TARGET_METRICS } from '../src/gates.js';

test('an insight with no declared target metric passes the ethics gate', () => {
  const result = runEthicsGate({ statement: 'MRR is trending down.' });
  assert.equal(result.passed, true);
});

test('an insight declaring a prohibited target metric fails the ethics gate', () => {
  const result = runEthicsGate({ statement: 'x', targetMetric: 'app_open_count' });
  assert.equal(result.passed, false);
  assert.match(result.reason, /app_open_count/);
});

test('every prohibited metric in the list is individually rejected', () => {
  for (const metric of PROHIBITED_TARGET_METRICS) {
    const result = runEthicsGate({ statement: 'x', targetMetric: metric });
    assert.equal(result.passed, false, `expected ${metric} to be rejected`);
  }
});

test('a restricted insight passes the security gate for a platform cleared for restricted', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public', 'restricted']);
  assert.equal(result.passed, true);
});

test('a restricted insight fails the security gate for a public-only-cleared platform', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /not cleared/);
});

test('an insight with no declared classification defaults to public and passes for any clearance', () => {
  const result = runSecurityGate({}, ['public']);
  assert.equal(result.passed, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-intelligence && node --test test/gates.test.js`
Expected: FAIL — `Cannot find module '../src/gates.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-intelligence/src/gates.js

/**
 * Ethics and Security gates for revenue-intelligence-generated Insights.
 * Same shape as services/insight-delivery/src/gates.js -- duplicated
 * per this repo's established convention, not imported (design spec
 * Global Constraints).
 */
export const PROHIBITED_TARGET_METRICS = [
  'raw_session_time',
  'app_open_count',
  'scroll_depth',
  'notification_click_through_terminal',
  'streak_length_for_its_own_sake',
  'variable_reward_schedule_effectiveness',
  'time_to_return_after_notification',
];

/**
 * @param {{targetMetric?: string}} insight
 * @returns {{passed: boolean, reason?: string}}
 */
export function runEthicsGate(insight) {
  const metric = insight?.targetMetric;
  if (metric && PROHIBITED_TARGET_METRICS.includes(metric)) {
    return { passed: false, reason: `"${metric}" is a prohibited engagement target (brain.dopemine.md §2).` };
  }
  return { passed: true };
}

/**
 * @param {{classification?: 'public'|'restricted'}} insight
 * @param {Array<'public'|'restricted'>} targetPlatformClearance
 * @returns {{passed: boolean, reason?: string}}
 */
export function runSecurityGate(insight, targetPlatformClearance) {
  const classification = insight?.classification ?? 'public';
  if (!targetPlatformClearance.includes(classification)) {
    return { passed: false, reason: `Target platform is not cleared for "${classification}" insights.` };
  }
  return { passed: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-intelligence && node --test test/gates.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-intelligence/src/gates.js services/revenue-intelligence/test/gates.test.js
git commit -m "feat(revenue-intelligence): add ethics and security gates"
```

---

### Task 3: Dot.Memory client

**Files:**
- Create: `services/revenue-intelligence/src/memory-client.js`
- Test: `services/revenue-intelligence/test/memory-client.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces (same shape as `services/insight-delivery/src/memory-client.js`, minus `searchInsights`/`getInsight`, which nothing in this plan calls):
  - `memoryConfig(env = process.env) => {enabled: boolean, url?: string, token?: string}`
  - `recordInsight(cfg, insight: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`
  - `recordAction(cfg, envelope: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`
  - `recordOutcome(cfg, envelope: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-intelligence/test/memory-client.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryConfig, recordInsight, recordAction, recordOutcome } from '../src/memory-client.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

test('memoryConfig is disabled when env vars are missing', () => {
  assert.deepEqual(memoryConfig({}), { enabled: false });
});

test('memoryConfig is enabled and strips trailing slashes when env vars are present', () => {
  assert.deepEqual(
    memoryConfig({ DOT_MEMORY_URL: 'https://memory.test/', DOT_MEMORY_TOKEN: 'tok' }),
    { enabled: true, url: 'https://memory.test', token: 'tok' },
  );
});

test('recordInsight posts to /api/intelligence/insights and reports ok', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  const result = await recordInsight(CFG, { statement: 'x', domain: 'revenue' }, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://memory.test/api/intelligence/insights');
  assert.equal(calls[0].body.domain, 'revenue');
});

test('recordInsight reports not-ok with a reason when Memory is disabled', async () => {
  const result = await recordInsight({ enabled: false }, { statement: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
});

test('recordInsight reports not-ok with a reason on an HTTP error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const result = await recordInsight(CFG, { statement: 'x' }, fetchImpl);
  assert.equal(result.ok, false);
  assert.match(result.reason, /503/);
});

test('recordAction and recordOutcome post to their respective intelligence-loop endpoints', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(String(url)); return { ok: true, status: 201, json: async () => ({ data: {} }) }; };
  await recordAction(CFG, { loop_id: 'loop-1' }, fetchImpl);
  await recordOutcome(CFG, { loop_id: 'loop-1' }, fetchImpl);
  assert.equal(calls[0], 'https://memory.test/api/intelligence/actions');
  assert.equal(calls[1], 'https://memory.test/api/intelligence/outcomes');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-intelligence && node --test test/memory-client.test.js`
Expected: FAIL — `Cannot find module '../src/memory-client.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-intelligence/src/memory-client.js

/**
 * Dot.Memory client for revenue-intelligence-generated Insights. Same
 * shape as services/insight-delivery/src/memory-client.js -- every call
 * degrades honestly, an unreachable Memory is reported as {ok: false,
 * reason}, never treated as an empty or negative result.
 */

export function memoryConfig(env = process.env) {
  const url = env.DOT_MEMORY_URL;
  const token = env.DOT_MEMORY_TOKEN;

  return url && token
    ? { enabled: true, url: url.replace(/\/+$/, ''), token }
    : { enabled: false };
}

async function call(cfg, method, path, body, fetchImpl) {
  const response = await fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Dot.Memory answered HTTP ${response.status} for ${method} ${path}`);
  }

  return response.json();
}

export async function recordInsight(cfg, insight, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/insights', insight, fetchImpl);
}

export async function recordAction(cfg, envelope, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/actions', envelope, fetchImpl);
}

export async function recordOutcome(cfg, envelope, fetchImpl = fetch) {
  return write(cfg, '/api/intelligence/outcomes', envelope, fetchImpl);
}

async function write(cfg, path, envelope, fetchImpl) {
  if (!cfg.enabled) {
    return { ok: false, reason: 'Dot.Memory is not configured' };
  }

  try {
    await call(cfg, 'POST', path, envelope, fetchImpl);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-intelligence && node --test test/memory-client.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-intelligence/src/memory-client.js services/revenue-intelligence/test/memory-client.test.js
git commit -m "feat(revenue-intelligence): add Dot.Memory client"
```

---

### Task 4: Notify-routed delivery, scoped to admin

**Files:**
- Create: `services/revenue-intelligence/src/deliver.js`
- Test: `services/revenue-intelligence/test/deliver.test.js`

**Interfaces:**
- Consumes: `recordAction(cfg, envelope, fetchImpl)` and `recordOutcome(cfg, envelope, fetchImpl)` from Task 3 (`memory-client.js`).
- Produces:
  - `deliverInsight({insightId, targetPlatform, cfg, notifyClient, fetchImpl = fetch, now = () => new Date(), loopId}) => Promise<{loop_id: string, delivered: boolean, execution_status: string, recorded: boolean}>`
  - `recordDeliveryOutcome(cfg, {loopId, insightId, verdict, observedAt}, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`

Unlike `services/insight-delivery`'s version of this file, `scope` is not a caller-supplied parameter here — `deliverInsight` always delivers with `scope: 'admin'` (design spec §2).

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-intelligence/test/deliver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverInsight, recordDeliveryOutcome } from '../src/deliver.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

function world() {
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    writes.push({ url: String(url), body: JSON.parse(options.body ?? '{}') });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  return { fetchImpl, writes };
}

test('deliverInsight always delivers with scope admin, regardless of caller input', async () => {
  const w = world();
  let receivedArgs;
  const notifyClient = { deliver: async (args) => { receivedArgs = args; return { status: 'succeeded' }; } };

  const result = await deliverInsight({
    insightId: 'dot-billing:revenue.mrr@2026-09-23T10:00:00.000Z',
    targetPlatform: 'dot-billing',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  assert.equal(result.loop_id, 'loop-x');
  assert.equal(result.delivered, true);
  assert.equal(result.execution_status, 'succeeded');
  assert.equal(result.recorded, true);
  assert.equal(receivedArgs.scope, 'admin');
});

test('deliverInsight records an action envelope with all six intelligence-loop required fields', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  await deliverInsight({
    insightId: 'ins-1',
    targetPlatform: 'dot-billing',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  const action = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.ok(action, 'the action envelope must be recorded');
  for (const field of ['loop_id', 'stage', 'platform', 'subject', 'source', 'occurred_at']) {
    assert.ok(field in action.body, `action envelope is missing required field ${field}`);
  }
  assert.equal(action.body.action.kind, 'insight.deliver');
  assert.equal(action.body.action.executor_platform, 'dot-notify');
  assert.equal(action.body.action.detail.scope, 'admin');
});

test('deliverInsight reports failed execution status without throwing', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'failed', detail: { reason: 'endpoint down' } }) };

  const result = await deliverInsight({ insightId: 'ins-3', targetPlatform: 'dot-billing', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.equal(result.delivered, false);
  assert.equal(result.execution_status, 'failed');
});

test('recordDeliveryOutcome posts an outcome envelope with all six intelligence-loop required fields', async () => {
  const w = world();
  const result = await recordDeliveryOutcome(CFG, {
    loopId: 'loop-x',
    insightId: 'ins-1',
    verdict: 'improved',
    observedAt: '2026-09-23T12:00:00.000Z',
  }, w.fetchImpl);

  assert.equal(result.ok, true);
  const outcome = w.writes.find((wr) => wr.url.endsWith('/outcomes'));
  for (const field of ['loop_id', 'stage', 'platform', 'subject', 'source', 'occurred_at']) {
    assert.ok(field in outcome.body, `outcome envelope is missing required field ${field}`);
  }
  assert.equal(outcome.body.outcome.verdict, 'improved');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-intelligence && node --test test/deliver.test.js`
Expected: FAIL — `Cannot find module '../src/deliver.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-intelligence/src/deliver.js
import { randomUUID } from 'node:crypto';
import { recordAction, recordOutcome } from './memory-client.js';

const SCOPE = 'admin';

/**
 * Push delivery of a gate-cleared, revenue-intelligence-generated
 * Insight, routed entirely through Dot.Notify (design spec §2), always
 * scoped to admin recipients -- Notify's own per-recipient consent/role
 * resolution decides who that reaches, the same mechanism every other
 * platform's alerts already use.
 *
 * @param {object} args
 * @param {string} args.insightId
 * @param {string} args.targetPlatform
 * @param {object} args.cfg
 * @param {{deliver: (a: {insightId: string, targetPlatform: string, scope: string}) => Promise<{status: string, detail?: object}>}} args.notifyClient
 * @param {typeof fetch} [args.fetchImpl]
 * @param {() => Date} [args.now]
 * @param {string} [args.loopId]
 */
export async function deliverInsight({
  insightId,
  targetPlatform,
  cfg,
  notifyClient,
  fetchImpl = fetch,
  now = () => new Date(),
  loopId = `loop-${randomUUID()}`,
}) {
  const result = await notifyClient.deliver({ insightId, targetPlatform, scope: SCOPE });

  const actionResult = await recordAction(cfg, {
    loop_id: loopId,
    stage: 'action',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'revenue-intelligence',
    action: {
      kind: 'insight.deliver',
      executor_platform: 'dot-notify',
      detail: { insight_id: insightId, target_platform: targetPlatform, scope: SCOPE },
      execution_status: result.status,
    },
    occurred_at: now().toISOString(),
  }, fetchImpl);

  return {
    loop_id: loopId,
    delivered: result.status === 'succeeded',
    execution_status: result.status,
    recorded: actionResult.ok,
  };
}

/**
 * Closes the loop's outcome stage from Dot.Notify's existing
 * messaging.delivery.acted/ignored event -- no new outcome-tracking
 * mechanism, same as services/insight-delivery.
 */
export async function recordDeliveryOutcome(cfg, { loopId, insightId, verdict, observedAt }, fetchImpl = fetch) {
  return recordOutcome(cfg, {
    loop_id: loopId,
    stage: 'outcome',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'revenue-intelligence',
    occurred_at: observedAt,
    outcome: { verdict, observed_at: observedAt },
  }, fetchImpl);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-intelligence && node --test test/deliver.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-intelligence/src/deliver.js services/revenue-intelligence/test/deliver.test.js
git commit -m "feat(revenue-intelligence): add Notify-routed delivery scoped to admin recipients"
```

---

### Task 5: Pipeline

**Files:**
- Create: `services/revenue-intelligence/src/pipeline.js`
- Test: `services/revenue-intelligence/test/pipeline.test.js`

**Interfaces:**
- Consumes: `detectOpportunities` (Task 1), `runEthicsGate`/`runSecurityGate` (Task 2), `recordInsight` (Task 3), `deliverInsight` (Task 4).
- Produces:
  - `runPipeline({pollResult, cfg, notifyClient, targetPlatformClearance?, fetchImpl?}) => Promise<{delivered: Array<{insight: object, recorded: boolean, delivered: boolean}>, rejected: Array<{insight: object, gate: 'ethics'|'security', reason: string}>}>`
  - `targetPlatformClearance` defaults to `['public']` if omitted.

The insight identifier passed to `deliverInsight` is the candidate's own `evidence[0].reference` — already unique per (platform, signal, timestamp) from Task 1, so no round-trip to Dot.Memory for an assigned ID is needed.

- [ ] **Step 1: Write the failing tests**

```js
// services/revenue-intelligence/test/pipeline.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline } from '../src/pipeline.js';

const CFG = { enabled: true, url: 'https://memory.test', token: 'tok' };

function world() {
  const writes = [];
  const fetchImpl = async (url, options = {}) => {
    writes.push({ url: String(url), body: JSON.parse(options.body ?? '{}') });
    return { ok: true, status: 201, json: async () => ({ data: {} }) };
  };
  return { fetchImpl, writes };
}

const POLL_RESULT = {
  platform: 'dot-billing',
  generated_at: '2026-09-23T10:00:00.000Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 1000, trend: 'down' }],
};

test('a gate-cleared candidate is recorded and delivered', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  const result = await runPipeline({
    pollResult: POLL_RESULT,
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public', 'restricted'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.delivered[0].delivered, true);
  assert.equal(result.delivered[0].recorded, true);

  const recordWrite = w.writes.find((wr) => wr.url.endsWith('/insights'));
  assert.ok(recordWrite, 'the insight must be recorded');
  assert.equal(recordWrite.body.domain, 'revenue');

  const actionWrite = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.equal(actionWrite.body.action.executor_platform, 'dot-notify');
  assert.equal(actionWrite.body.action.detail.scope, 'admin');
});

test('a candidate rejected by the security gate is never recorded or delivered', async () => {
  const w = world();
  const notifyClient = { deliver: async () => { throw new Error('should not be called'); } };

  const result = await runPipeline({
    pollResult: POLL_RESULT,
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].gate, 'security');
  assert.equal(w.writes.length, 0);
});

test('no candidates means nothing recorded, delivered, or rejected', async () => {
  const w = world();
  const notifyClient = { deliver: async () => { throw new Error('should not be called'); } };

  const result = await runPipeline({
    pollResult: { ...POLL_RESULT, signals: [] },
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
  });

  assert.deepEqual(result, { delivered: [], rejected: [] });
});

test('multiple gate-cleared candidates are each recorded and delivered independently', async () => {
  const w = world();
  let deliverCalls = 0;
  const notifyClient = { deliver: async () => { deliverCalls++; return { status: 'succeeded' }; } };

  const result = await runPipeline({
    pollResult: {
      ...POLL_RESULT,
      signals: [
        { key: 'revenue.mrr', value: 1000, trend: 'down' },
        { key: 'revenue.churn_rate', value: 0.5 },
      ],
    },
    cfg: CFG,
    notifyClient,
    targetPlatformClearance: ['public', 'restricted'],
    fetchImpl: w.fetchImpl,
  });

  assert.equal(result.delivered.length, 2);
  assert.equal(deliverCalls, 2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/revenue-intelligence && node --test test/pipeline.test.js`
Expected: FAIL — `Cannot find module '../src/pipeline.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/revenue-intelligence/src/pipeline.js
import { detectOpportunities } from './opportunities.js';
import { runEthicsGate, runSecurityGate } from './gates.js';
import { recordInsight } from './memory-client.js';
import { deliverInsight } from './deliver.js';

/**
 * Detect -> gate -> record -> deliver for one Revenue Reader poll
 * result (design spec §3). Every candidate is accounted for in exactly
 * one of the two returned arrays -- nothing is silently dropped.
 *
 * @param {object} args
 * @param {object} args.pollResult
 * @param {object} args.cfg
 * @param {object} args.notifyClient
 * @param {Array<'public'|'restricted'>} [args.targetPlatformClearance]
 * @param {typeof fetch} [args.fetchImpl]
 */
export async function runPipeline({ pollResult, cfg, notifyClient, targetPlatformClearance = ['public'], fetchImpl = fetch }) {
  const candidates = detectOpportunities(pollResult);
  const delivered = [];
  const rejected = [];

  for (const insight of candidates) {
    const ethics = runEthicsGate(insight);
    if (!ethics.passed) {
      rejected.push({ insight, gate: 'ethics', reason: ethics.reason });
      continue;
    }

    const security = runSecurityGate(insight, targetPlatformClearance);
    if (!security.passed) {
      rejected.push({ insight, gate: 'security', reason: security.reason });
      continue;
    }

    const insightId = insight.evidence[0].reference;
    const recordResult = await recordInsight(cfg, insight, fetchImpl);
    const deliverResult = await deliverInsight({
      insightId,
      targetPlatform: pollResult.platform,
      cfg,
      notifyClient,
      fetchImpl,
    });

    delivered.push({ insight, recorded: recordResult.ok, delivered: deliverResult.delivered });
  }

  return { delivered, rejected };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/revenue-intelligence && node --test test/pipeline.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/revenue-intelligence/src/pipeline.js services/revenue-intelligence/test/pipeline.test.js
git commit -m "feat(revenue-intelligence): add detect-gate-record-deliver pipeline"
```

---

### Task 6: CLI, package.json, README, CI registration

**Files:**
- Create: `services/revenue-intelligence/package.json`
- Create: `services/revenue-intelligence/src/cli.js`
- Create: `services/revenue-intelligence/README.md`
- Modify: `.github/workflows/tests.yml`

**Interfaces:**
- Consumes: `detectOpportunities` (Task 1).
- Produces: a `bin` entry point, `revenue-intelligence`, with one subcommand `detect` — no new exported functions consumed by later tasks.

`detect` is the only CLI command shipped: it is pure and always usable. `runPipeline`'s delivery step needs a real `notifyClient`, which does not exist yet (no platform is enrolled) — rather than ship a CLI command that always errors (matching `services/insight-delivery`'s CLI precedent of failing loudly instead of faking a capability), `runPipeline` remains a library function for a future orchestration layer to call directly.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@dot-brain/revenue-intelligence",
  "version": "1.0.0",
  "description": "Opportunity-detection heuristics over a Revenue Reader poll result, feeding the same gate/record/Notify-routed-delivery pipeline shape as insight-delivery, scoped to admin recipients. See ../../docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md.",
  "type": "module",
  "bin": { "revenue-intelligence": "./src/cli.js" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=22.5.0" }
}
```

- [ ] **Step 2: Write `src/cli.js`**

```js
#!/usr/bin/env node
// Usage: revenue-intelligence detect --signals-file <path.json>
// <path.json> must contain a Revenue Reader poll success result:
// {platform, generated_at, classification, signals}
import { readFileSync } from 'node:fs';
import { detectOpportunities } from './opportunities.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

if (cmd === 'detect') {
  const file = flag('signals-file');
  if (!file) {
    console.error('usage: revenue-intelligence detect --signals-file <path.json>');
    process.exit(1);
  }

  const pollResult = JSON.parse(readFileSync(file, 'utf8'));
  const insights = detectOpportunities(pollResult);
  console.log(JSON.stringify(insights, null, 2));
} else {
  console.error('usage: revenue-intelligence detect --signals-file <path.json>');
  process.exit(1);
}
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Dot.Brain — Revenue Intelligence

Opportunity-detection heuristics over a [Revenue Reader](../revenue-reader/README.md)
poll result (design spec:
[docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md](../../docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md)).

Feeds the same gate → record → Notify-routed-delivery pipeline shape as
[Insight Delivery](../insight-delivery/README.md) (ADR-0017), duplicated
here per this repo's established convention -- every service owns its
own small clients rather than importing a sibling's -- with delivery
always scoped to `admin` recipients. Notify's own per-recipient
consent/role resolution decides who that reaches; no new targeting
infrastructure exists here.

## No platform is enrolled yet

Like Revenue Reader (ADR-0018), this ships the generic capability only.
There is no scheduling layer that polls a platform and feeds its result
here automatically -- that composition is a future orchestration layer's
job, once a platform actually enrolls.

## Pipeline

1. `detectOpportunities()` — three v1 heuristics: MRR decline, high
   churn rate (>5%), and a rising payout-delay trend. An insight's
   `classification` always comes from the poll result itself, never
   invented; its `evidence` references only the triggering signal, not
   the full raw payload.
2. `runEthicsGate()` / `runSecurityGate()` — same as Insight Delivery's.
3. `recordInsight()` — gate-cleared insights are recorded to Dot.Memory.
4. `deliverInsight()` — push, routed through Dot.Notify, always
   `audience: 'admin'`.
5. `recordDeliveryOutcome()` — closes the loop from Notify's existing
   delivery event, same as Insight Delivery.

`runPipeline()` ties the first four together for one poll result; every
candidate ends up in either `delivered` or `rejected`, nothing silently
dropped. `recordDeliveryOutcome()` (step 5) is not part of that call --
it closes the loop later, from Notify's own separate delivery-outcome
event.

## CLI

Only `detect` is exposed — it is pure and always usable:

```bash
revenue-intelligence detect --signals-file signals.json
```

`runPipeline()`'s delivery step needs a real Dot.Notify client, which
doesn't exist yet (no platform is enrolled) -- it remains a library
function for a future orchestration layer to call directly, rather than
a CLI command that would always fail.

## Environment

```
DOT_MEMORY_URL=https://memory.infodot.co.za
DOT_MEMORY_TOKEN=…
```

## Tests

```bash
npm test
```
```

- [ ] **Step 4: Register the service in CI**

Read `.github/workflows/tests.yml` first to confirm the exact current matrix and `covered` list (they were last touched by the Cross-Platform Read Access work — `revenue-reader` should already be present). Add `revenue-intelligence` to both:

```yaml
      matrix:
        service:
          - guardian
          - intelligence
          - autonomy-score
          - market-research
          - intervention-log
          - guardian-trigger
          - blupin-context
          - insight-delivery
          - revenue-reader
          - revenue-intelligence
```

And to the `covered="..."` string in the `coverage-of-suites` job:

```bash
covered="guardian intelligence autonomy-score market-research intervention-log guardian-trigger blupin-context insight-delivery revenue-reader revenue-intelligence"
```

- [ ] **Step 5: Run the full test suite to confirm nothing broke**

Run: `cd services/revenue-intelligence && npm test`
Expected: PASS (all 31 tests across the five test files: 11 opportunities + 6 gates + 6 memory-client + 4 deliver + 4 pipeline)

- [ ] **Step 6: Commit**

```bash
git add services/revenue-intelligence/package.json services/revenue-intelligence/src/cli.js services/revenue-intelligence/README.md .github/workflows/tests.yml
git commit -m "feat(revenue-intelligence): add CLI, package manifest, README, and CI registration"
```

---

### Task 7: `brain.architecture.md` — new component

**Files:**
- Modify: `brain.architecture.md`

- [ ] **Step 1: Read the file first** to locate its exact current §2 (Layer model) Mermaid diagram and §3 (Component responsibilities) table — these were already touched twice this session (Insight Delivery, then Revenue Reader) so confirm current line numbers before editing rather than assuming prior citations still hold.

- [ ] **Step 2: Add a new node to the §2 diagram**

In the Layer 4 — Delivery subgraph (alongside `INSDEL`), add a sibling node, and an edge from `REVREAD` (the Revenue Reader node added in the Cross-Platform Read Access work):

```
REVINTEL[Revenue Intelligence<br/>opportunity detection]
```

```
REVREAD --> REVINTEL
```

Do not wire `REVINTEL` into `GRAPH` (the Knowledge Graph) — like Revenue Reader, it never persists raw data; only gate-cleared Insights reach Dot.Memory via the same recording path Insight Delivery already uses.

- [ ] **Step 3: Add the component table row**

In §3's component table, directly under the Revenue Reader row, add:

```markdown
| Revenue Intelligence | Detect revenue opportunities from Revenue Reader's poll results; gate, record, and deliver as Insights scoped to admin recipients | [docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md](docs/superpowers/specs/2026-09-23-revenue-intelligence-design.md) | Architecture, reference implementation `services/revenue-intelligence` |
```

- [ ] **Step 4: Verify**

Run: `grep -n "Revenue Intelligence" brain.architecture.md`
Expected: at least 3 matches (diagram node, diagram edge, table row).

- [ ] **Step 5: Commit**

```bash
git add brain.architecture.md
git commit -m "docs(brain.architecture): document the Revenue Intelligence component"
```

---

## Final verification

- [ ] Run the full new service's test suite: `cd services/revenue-intelligence && npm test` — expect all tests passing (31 tests across 5 files: 11 opportunities + 6 gates + 6 memory-client + 4 deliver + 4 pipeline).
- [ ] Confirm no other service's files were touched: `git diff --stat main -- services/` should show only `services/revenue-intelligence/` as new, nothing else modified.
- [ ] Confirm every doc cross-reference resolves to a real path: `grep -rn "revenue-intelligence" brain.*.md | wc -l` should be ≥ 3.
- [ ] Confirm the CI matrix and coverage-of-suites list both include `revenue-intelligence`: `grep -c "revenue-intelligence" .github/workflows/tests.yml` should be ≥ 2.

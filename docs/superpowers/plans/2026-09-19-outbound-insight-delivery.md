# Outbound Insight Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Dot.Brain a second outbound path — a gate-cleared, non-structural **Insight** — delivered to platforms either by pull (queried directly) or by push (routed through Dot.Notify), alongside the existing PR-Generator-only path, per `docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md`.

**Architecture:** A new standalone service, `services/insight-delivery/`, following the exact conventions already used by `services/intelligence` and `services/blupin-context` (ES modules, `node --test`, injectable `fetch`, a Dot.Memory client, a CLI `bin`). It provides: (1) a pure classification function routing W3 conclusions to Recommendation vs Insight, (2) pure Ethics/Security gate functions, (3) a Dot.Memory client that records and queries Insights, and (4) a delivery function that emits an ADR-0015 intelligence-loop `action` envelope with `executor_platform: "dot-notify"` and records the resulting outcome. Six existing spec/platform docs are updated to describe the new path; no code changes are made to the PR Generator, to any gate agent's core policy, or to Dot.Notify itself.

**Tech Stack:** Node.js ≥ 22.5 (ESM), built-in `node:test` + `node:assert/strict` (matches every sibling service), no external dependencies.

## Global Constraints

- Governance gate is never invoked for an Insight candidate — only Ethics and Security run (design spec §2).
- An ambiguous classification (conclusion doesn't clearly say whether it implies a platform change) always routes to Recommendation, never to Insight (design spec §1, Testing section).
- No new JSON schema is introduced — `schemas/insight.schema.json` is reused as-is (design spec Goal).
- Brain never chooses a delivery channel, touches consent state, or retries a Notify delivery itself — that is entirely Dot.Notify's existing job (design spec §4).
- Every Dot.Memory write/read call must degrade honestly: an unreachable Memory is reported as `{ available: false, reason }` or `{ ok: false, reason }`, never treated as an empty/negative result (matches `services/intelligence/src/memory-client.js`'s existing convention).
- No code changes to `services/guardian`, `services/intelligence`'s existing files, or any `brain.*.md` document's existing content beyond the additions this plan specifies.

---

## File Structure

```
services/insight-delivery/
  package.json
  README.md
  src/
    classify.js         # conclusion -> 'recommendation' | 'insight'
    gates.js             # runEthicsGate, runSecurityGate
    memory-client.js      # memoryConfig, recordInsight, searchInsights, getInsight, recordAction, recordOutcome
    deliver.js            # deliverInsight, recordDeliveryOutcome
    cli.js                # bin entry point wiring the above
  test/
    classify.test.js
    gates.test.js
    memory-client.test.js
    deliver.test.js

brain.workflows.md          # modified: classification step + gate table row
brain.api.md                 # modified: /v1/insights/* surface + endpoint entries
brain.architecture.md        # modified: two outbound paths, component table row
adr/ADR-0017-outbound-insight-delivery.md   # new
platforms/dot-notify.md      # modified: insight.deliver row under Intelligence Consumed
README.md                    # modified: one line under "What Dot.Brain IS"
```

---

### Task 1: Conclusion classification

**Files:**
- Create: `services/insight-delivery/src/classify.js`
- Test: `services/insight-delivery/test/classify.test.js`

**Interfaces:**
- Produces: `classifyConclusion(conclusion: { impliesPlatformChange?: boolean }) => 'recommendation' | 'insight'`

- [ ] **Step 1: Write the failing tests**

```js
// services/insight-delivery/test/classify.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyConclusion } from '../src/classify.js';

test('a conclusion that implies a platform change classifies as recommendation', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: true }), 'recommendation');
});

test('a conclusion with no implied change classifies as insight', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: false }), 'insight');
});

test('an ambiguous conclusion (field omitted) defaults to recommendation, the stricter path', () => {
  assert.equal(classifyConclusion({}), 'recommendation');
});

test('an ambiguous conclusion (explicit undefined) also defaults to recommendation', () => {
  assert.equal(classifyConclusion({ impliesPlatformChange: undefined }), 'recommendation');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/insight-delivery && node --test test/classify.test.js`
Expected: FAIL — `Cannot find module '../src/classify.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/insight-delivery/src/classify.js

/**
 * Routes a W3 reasoning conclusion to Recommendation or Insight
 * (design spec §1). A conclusion cannot be both. An ambiguous
 * conclusion always takes the stricter, human-reviewed path.
 *
 * @param {{impliesPlatformChange?: boolean}} conclusion
 * @returns {'recommendation'|'insight'}
 */
export function classifyConclusion(conclusion) {
  return conclusion?.impliesPlatformChange === false ? 'insight' : 'recommendation';
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/insight-delivery && node --test test/classify.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/insight-delivery/src/classify.js services/insight-delivery/test/classify.test.js
git commit -m "feat(insight-delivery): add conclusion classification"
```

---

### Task 2: Ethics and Security gates

**Files:**
- Create: `services/insight-delivery/src/gates.js`
- Test: `services/insight-delivery/test/gates.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `PROHIBITED_TARGET_METRICS: string[]`
  - `runEthicsGate(insight: {targetMetric?: string}) => {passed: boolean, reason?: string}`
  - `runSecurityGate(insight: {classification?: 'public'|'restricted'}, targetPlatformClearance: Array<'public'|'restricted'>) => {passed: boolean, reason?: string}`

- [ ] **Step 1: Write the failing tests**

```js
// services/insight-delivery/test/gates.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runEthicsGate, runSecurityGate, PROHIBITED_TARGET_METRICS } from '../src/gates.js';

test('an insight with no declared target metric passes the ethics gate', () => {
  const result = runEthicsGate({ statement: 'Three platforms hit the same onboarding bottleneck last week.' });
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

test('a public insight passes the security gate for a public-cleared platform', () => {
  const result = runSecurityGate({ classification: 'public' }, ['public']);
  assert.equal(result.passed, true);
});

test('a restricted insight fails the security gate for a public-only-cleared platform', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public']);
  assert.equal(result.passed, false);
  assert.match(result.reason, /not cleared/);
});

test('a restricted insight passes the security gate for a platform cleared for restricted', () => {
  const result = runSecurityGate({ classification: 'restricted' }, ['public', 'restricted']);
  assert.equal(result.passed, true);
});

test('an insight with no declared classification defaults to public and passes for any clearance', () => {
  const result = runSecurityGate({}, ['public']);
  assert.equal(result.passed, true);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/insight-delivery && node --test test/gates.test.js`
Expected: FAIL — `Cannot find module '../src/gates.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/insight-delivery/src/gates.js

/**
 * Ethics and Security gates for outbound Insights (design spec §2).
 * Governance is deliberately never invoked here — an Insight is never
 * applied to a platform, so there is no decision-rights question.
 *
 * Reuses the prohibited-target-metric list from brain.dopemine.md §2
 * verbatim, applied here to Insight targets the same way the Dopamine
 * gate already applies it to Recommendation impact blocks.
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
 * Classification-leak check: an insight's classification must be at or
 * below the target platform's clearance. `insight.classification`
 * defaults to 'public' when absent, matching "narrowed only" behavior
 * elsewhere in the Query API (brain.api.md §3).
 *
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

Run: `cd services/insight-delivery && node --test test/gates.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add services/insight-delivery/src/gates.js services/insight-delivery/test/gates.test.js
git commit -m "feat(insight-delivery): add ethics and security gates"
```

---

### Task 3: Dot.Memory client — record and query Insights

**Files:**
- Create: `services/insight-delivery/src/memory-client.js`
- Test: `services/insight-delivery/test/memory-client.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces:
  - `memoryConfig(env = process.env) => {enabled: boolean, url?: string, token?: string}`
  - `recordInsight(cfg, insight: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`
  - `searchInsights(cfg, {domain, scope, platform} = {}, fetchImpl = fetch) => Promise<{available: boolean, items?: object[], reason?: string}>`
  - `getInsight(cfg, id: string, fetchImpl = fetch) => Promise<{available: boolean, item?: object, reason?: string}>`
  - `recordAction(cfg, envelope: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`
  - `recordOutcome(cfg, envelope: object, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`

This mirrors `services/intelligence/src/memory-client.js`'s exact shape (same `memoryConfig`, same disabled/error handling, same `call()` helper) with two new read/write pairs for Insights instead of `fetchContext`/`recordDecision`.

- [ ] **Step 1: Write the failing tests**

```js
// services/insight-delivery/test/memory-client.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryConfig, recordInsight, searchInsights, getInsight, recordAction, recordOutcome } from '../src/memory-client.js';

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
  const result = await recordInsight(CFG, { statement: 'x', domain: 'onboarding' }, fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(calls[0].url, 'https://memory.test/api/intelligence/insights');
  assert.equal(calls[0].body.statement, 'x');
});

test('recordInsight reports not-ok with a reason when Memory is disabled', async () => {
  const result = await recordInsight({ enabled: false }, { statement: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.reason, /not configured/);
});

test('searchInsights queries by domain/scope/platform and returns items', async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/intelligence\/insights\?domain=onboarding&scope=global&platform=dot-hr/);
    return { ok: true, status: 200, json: async () => ({ data: { items: [{ id: 'ins-1' }] } }) };
  };
  const result = await searchInsights(CFG, { domain: 'onboarding', scope: 'global', platform: 'dot-hr' }, fetchImpl);
  assert.equal(result.available, true);
  assert.equal(result.items.length, 1);
});

test('searchInsights degrades honestly when Memory is unreachable', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const result = await searchInsights(CFG, {}, fetchImpl);
  assert.equal(result.available, false);
  assert.ok(result.reason);
});

test('getInsight fetches by id', async () => {
  const fetchImpl = async (url) => {
    assert.equal(String(url), 'https://memory.test/api/intelligence/insights/ins-1');
    return { ok: true, status: 200, json: async () => ({ data: { id: 'ins-1', statement: 'x' } }) };
  };
  const result = await getInsight(CFG, 'ins-1', fetchImpl);
  assert.equal(result.available, true);
  assert.equal(result.item.id, 'ins-1');
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

Run: `cd services/insight-delivery && node --test test/memory-client.test.js`
Expected: FAIL — `Cannot find module '../src/memory-client.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/insight-delivery/src/memory-client.js

/**
 * Dot.Brain's client for Dot.Memory, for the outbound Insight path
 * (design spec §3-4). Mirrors services/intelligence/src/memory-client.js's
 * shape: every call degrades honestly -- an unreachable Memory is reported
 * as unavailable/not-ok, never as an empty or negative result.
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

export async function searchInsights(cfg, { domain, scope, platform } = {}, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { available: false, reason: 'Dot.Memory is not configured' };
  }

  const query = new URLSearchParams();
  if (domain) query.set('domain', domain);
  if (scope) query.set('scope', scope);
  if (platform) query.set('platform', platform);
  const qs = query.toString();

  try {
    const payload = await call(cfg, 'GET', `/api/intelligence/insights${qs ? `?${qs}` : ''}`, undefined, fetchImpl);
    return { available: true, items: payload.data?.items ?? [] };
  } catch (error) {
    return { available: false, reason: error.message };
  }
}

export async function getInsight(cfg, id, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { available: false, reason: 'Dot.Memory is not configured' };
  }

  try {
    const payload = await call(cfg, 'GET', `/api/intelligence/insights/${id}`, undefined, fetchImpl);
    return { available: true, item: payload.data };
  } catch (error) {
    return { available: false, reason: error.message };
  }
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

Run: `cd services/insight-delivery && node --test test/memory-client.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add services/insight-delivery/src/memory-client.js services/insight-delivery/test/memory-client.test.js
git commit -m "feat(insight-delivery): add Dot.Memory client for Insight record/query"
```

---

### Task 4: Notify-routed delivery

**Files:**
- Create: `services/insight-delivery/src/deliver.js`
- Test: `services/insight-delivery/test/deliver.test.js`

**Interfaces:**
- Consumes:
  - `recordAction(cfg, envelope, fetchImpl)` and `recordOutcome(cfg, envelope, fetchImpl)` from Task 3 (`memory-client.js`).
- Produces:
  - `deliverInsight({insightId, targetPlatform, scope, cfg, notifyClient, fetchImpl = fetch, now = () => new Date(), loopId}) => Promise<{loop_id: string, delivered: boolean, execution_status: string}>`
  - `recordDeliveryOutcome(cfg, {loopId, insightId, verdict, observedAt}, fetchImpl = fetch) => Promise<{ok: boolean, reason?: string}>`

`notifyClient` is an injectable `{ deliver: async ({insightId, targetPlatform, scope}) => ({status: 'succeeded'|'failed'|'pending', detail?: object}) }`, mirroring how `execute` is injected into `services/intelligence/src/loop.js`'s `runLoop`. This is the seam a real Dot.Notify integration plugs into later — building that integration is out of scope for this plan (design spec Non-goals: "no new... delivery UI... All of that is Notify's existing job").

- [ ] **Step 1: Write the failing tests**

```js
// services/insight-delivery/test/deliver.test.js
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

test('deliverInsight always emits an action envelope with executor_platform dot-notify', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'succeeded' }) };

  const result = await deliverInsight({
    insightId: 'ins-1',
    targetPlatform: 'dot-hr',
    scope: 'global',
    cfg: CFG,
    notifyClient,
    fetchImpl: w.fetchImpl,
    loopId: 'loop-x',
  });

  assert.equal(result.loop_id, 'loop-x');
  assert.equal(result.delivered, true);
  assert.equal(result.execution_status, 'succeeded');

  const action = w.writes.find((wr) => wr.url.endsWith('/actions'));
  assert.ok(action, 'the action envelope must be recorded');
  assert.equal(action.body.stage, 'action');
  assert.equal(action.body.platform, 'dot-brain');
  assert.equal(action.body.action.kind, 'insight.deliver');
  assert.equal(action.body.action.executor_platform, 'dot-notify');
  assert.equal(action.body.action.detail.insight_id, 'ins-1');
  assert.equal(action.body.action.detail.target_platform, 'dot-hr');
  assert.equal(action.body.action.detail.scope, 'global');
});

test('deliverInsight never lets Brain choose the channel -- notifyClient.deliver receives only insight identity, not channel details', async () => {
  const w = world();
  let receivedArgs;
  const notifyClient = { deliver: async (args) => { receivedArgs = args; return { status: 'succeeded' }; } };

  await deliverInsight({ insightId: 'ins-2', targetPlatform: 'dot-emall', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.deepEqual(Object.keys(receivedArgs).sort(), ['insightId', 'scope', 'targetPlatform']);
});

test('deliverInsight reports failed execution status without throwing', async () => {
  const w = world();
  const notifyClient = { deliver: async () => ({ status: 'failed', detail: { reason: 'endpoint down' } }) };

  const result = await deliverInsight({ insightId: 'ins-3', targetPlatform: 'dot-hr', cfg: CFG, notifyClient, fetchImpl: w.fetchImpl });

  assert.equal(result.delivered, false);
  assert.equal(result.execution_status, 'failed');
});

test('recordDeliveryOutcome posts an outcome envelope for the loop', async () => {
  const w = world();
  const result = await recordDeliveryOutcome(CFG, {
    loopId: 'loop-x',
    insightId: 'ins-1',
    verdict: 'improved',
    observedAt: '2026-09-19T00:00:00.000Z',
  }, w.fetchImpl);

  assert.equal(result.ok, true);
  const outcome = w.writes.find((wr) => wr.url.endsWith('/outcomes'));
  assert.equal(outcome.body.loop_id, 'loop-x');
  assert.equal(outcome.body.outcome.verdict, 'improved');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd services/insight-delivery && node --test test/deliver.test.js`
Expected: FAIL — `Cannot find module '../src/deliver.js'`

- [ ] **Step 3: Write the minimal implementation**

```js
// services/insight-delivery/src/deliver.js
import { randomUUID } from 'node:crypto';
import { recordAction, recordOutcome } from './memory-client.js';

/**
 * Push delivery of a gate-cleared Insight, routed entirely through
 * Dot.Notify (design spec §4). Brain records the ADR-0015 intelligence-loop
 * action envelope and hands the actual send to notifyClient -- it never
 * chooses a channel, touches consent, or retries delivery itself.
 *
 * @param {object} args
 * @param {string} args.insightId
 * @param {string} args.targetPlatform
 * @param {string} [args.scope]
 * @param {object} args.cfg
 * @param {{deliver: (a: {insightId: string, targetPlatform: string, scope?: string}) => Promise<{status: string, detail?: object}>}} args.notifyClient
 * @param {typeof fetch} [args.fetchImpl]
 * @param {() => Date} [args.now]
 * @param {string} [args.loopId]
 */
export async function deliverInsight({
  insightId,
  targetPlatform,
  scope,
  cfg,
  notifyClient,
  fetchImpl = fetch,
  now = () => new Date(),
  loopId = `loop-${randomUUID()}`,
}) {
  const result = await notifyClient.deliver({ insightId, targetPlatform, scope });

  await recordAction(cfg, {
    loop_id: loopId,
    stage: 'action',
    platform: 'dot-brain',
    subject: { type: 'insight', id: insightId },
    source: 'insight-classification',
    action: {
      kind: 'insight.deliver',
      executor_platform: 'dot-notify',
      detail: { insight_id: insightId, target_platform: targetPlatform, scope },
      execution_status: result.status,
    },
    occurred_at: now().toISOString(),
  }, fetchImpl);

  return { loop_id: loopId, delivered: result.status === 'succeeded', execution_status: result.status };
}

/**
 * Closes the loop's outcome stage from Dot.Notify's
 * messaging.delivery.acted/ignored event (design spec §4) -- no new
 * outcome-tracking mechanism, this consumes an event source Brain
 * already understands.
 */
export async function recordDeliveryOutcome(cfg, { loopId, insightId, verdict, observedAt }, fetchImpl = fetch) {
  return recordOutcome(cfg, {
    loop_id: loopId,
    stage: 'outcome',
    subject: { type: 'insight', id: insightId },
    outcome: { verdict, observed_at: observedAt },
  }, fetchImpl);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd services/insight-delivery && node --test test/deliver.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add services/insight-delivery/src/deliver.js services/insight-delivery/test/deliver.test.js
git commit -m "feat(insight-delivery): add Notify-routed delivery and outcome recording"
```

---

### Task 5: CLI, package.json, README

**Files:**
- Create: `services/insight-delivery/package.json`
- Create: `services/insight-delivery/src/cli.js`
- Create: `services/insight-delivery/README.md`

**Interfaces:**
- Consumes: `classifyConclusion` (Task 1), `runEthicsGate`/`runSecurityGate` (Task 2), `memoryConfig`/`recordInsight`/`searchInsights` (Task 3), `deliverInsight` (Task 4).
- Produces: a `bin` entry point, `insight-delivery`, with subcommands `classify`, `record`, `search`, `deliver` — no new exported functions consumed by later tasks.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "@dot-brain/insight-delivery",
  "version": "1.0.0",
  "description": "Outbound Insight delivery for Dot.Brain -- classifies W3 conclusions into Recommendation vs Insight, runs the Ethics/Security gates (Governance skipped by design), records gate-cleared Insights to Dot.Memory for pull queries, and delivers push notifications through Dot.Notify via the ADR-0015 intelligence-loop envelope. See ../../docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md.",
  "type": "module",
  "bin": { "insight-delivery": "./src/cli.js" },
  "scripts": { "test": "node --test" },
  "engines": { "node": ">=22.5.0" }
}
```

- [ ] **Step 2: Write `src/cli.js`**

```js
#!/usr/bin/env node
// Usage:
//   insight-delivery classify < conclusion.json
//   insight-delivery record < insight.json                 (runs gates, then records if cleared)
//   insight-delivery search --domain onboarding [--scope global] [--platform dot-hr]
//   insight-delivery deliver --id ins-1 --target dot-hr [--scope global]
import { classifyConclusion } from './classify.js';
import { runEthicsGate, runSecurityGate } from './gates.js';
import { memoryConfig, recordInsight, searchInsights } from './memory-client.js';
import { deliverInsight } from './deliver.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const cfg = memoryConfig();

if (cmd === 'classify') {
  const conclusion = await readStdin();
  console.log(classifyConclusion(conclusion));
} else if (cmd === 'record') {
  const insight = await readStdin();
  const ethics = runEthicsGate(insight);
  if (!ethics.passed) {
    console.error(`ethics gate rejected: ${ethics.reason}`);
    process.exit(1);
  }
  const security = runSecurityGate(insight, insight.targetPlatformClearance ?? ['public']);
  if (!security.passed) {
    console.error(`security gate rejected: ${security.reason}`);
    process.exit(1);
  }
  const result = await recordInsight(cfg, insight);
  if (!result.ok) {
    console.error(`record failed: ${result.reason}`);
    process.exit(1);
  }
  console.log('recorded');
} else if (cmd === 'search') {
  const result = await searchInsights(cfg, { domain: flag('domain'), scope: flag('scope'), platform: flag('platform') });
  console.log(JSON.stringify(result, null, 2));
} else if (cmd === 'deliver') {
  const insightId = flag('id');
  const targetPlatform = flag('target');
  const scope = flag('scope');
  if (!insightId || !targetPlatform) {
    console.error('usage: insight-delivery deliver --id <insight-id> --target <platform> [--scope <scope>]');
    process.exit(1);
  }
  console.error('deliver: no notifyClient wired in this CLI build -- integrate a real Dot.Notify client before use.');
  process.exit(1);
} else {
  console.error('usage: insight-delivery <classify|record|search|deliver>');
  process.exit(1);
}
```

- [ ] **Step 3: Write `README.md`**

```markdown
# Dot.Brain — Insight Delivery

Dot.Brain's outbound Insight path (design spec:
[docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md](../../docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md),
ADR: [ADR-0017](../../adr/ADR-0017-outbound-insight-delivery.md)).

A second outbound path alongside the PR Generator: a gate-cleared,
non-structural finding delivered to platforms either by pull (queried
directly from Dot.Memory) or by push, routed entirely through Dot.Notify
via the ADR-0015 intelligence-loop envelope.

## Pipeline

1. `classifyConclusion()` — a W3 conclusion that implies no platform
   file/config change becomes an Insight candidate. Ambiguous always
   defaults to Recommendation.
2. `runEthicsGate()` / `runSecurityGate()` — the same two gates
   Recommendations pass through. Governance is never invoked for an
   Insight: nothing is being applied, so there is no decision-rights
   question.
3. `recordInsight()` / `searchInsights()` / `getInsight()` — gate-cleared
   Insights are recorded to Dot.Memory and queryable immediately (the pull
   surface).
4. `deliverInsight()` — for push, emits an intelligence-loop `action`
   envelope with `executor_platform: "dot-notify"` and hands the actual
   send to an injected `notifyClient`. Brain never chooses the channel,
   touches consent, or retries — that's entirely Notify's job.
5. `recordDeliveryOutcome()` — closes the loop from Notify's existing
   `messaging.delivery.acted/ignored` event.

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

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `cd services/insight-delivery && npm test`
Expected: PASS (all 23 tests across the four test files)

- [ ] **Step 5: Commit**

```bash
git add services/insight-delivery/package.json services/insight-delivery/src/cli.js services/insight-delivery/README.md
git commit -m "feat(insight-delivery): add CLI, package manifest, and README"
```

---

### Task 6: `brain.workflows.md` — classification step and gate table

**Files:**
- Modify: `brain.workflows.md` (§4 "W3 — Reasoning", §5 "W4 — Recommendation gates")

- [ ] **Step 1: Add the classification step**

In §4, immediately after the existing sentence "Conclusions at ≥ 0.80 with a complete Why block advance to W4.", add:

```markdown
A conclusion advancing to W4 is classified as either a **Recommendation** candidate (implies a platform-owned file/config/code change) or an **Insight** candidate (informational only, `schemas/insight.schema.json` shape) — never both. An ambiguous conclusion defaults to Recommendation, the stricter, human-reviewed path. See [services/insight-delivery](services/insight-delivery/README.md) for the reference implementation and `docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md` for the full design.
```

- [ ] **Step 2: Add the Governance-skip row to the gate table**

In §5's gate table, add a row directly under the existing three-row table:

```markdown
| Governance (Insight candidates only) | — | **Skipped.** An Insight is never applied to a platform, so there is no decision-rights question to adjudicate; only Ethics and Security run. |
```

- [ ] **Step 3: Verify the cross-reference resolves**

Run: `grep -n "insight-delivery" brain.workflows.md`
Expected: two matches (the link text and the path), confirming both additions landed.

- [ ] **Step 4: Commit**

```bash
git add brain.workflows.md
git commit -m "docs(brain.workflows): add Insight classification step and Governance-skip gate row"
```

---

### Task 7: `brain.api.md` — `/v1/insights/*` surface

**Files:**
- Modify: `brain.api.md` (§1 "Surface map", §2 "Endpoint contracts")

- [ ] **Step 1: Add the two new rows to the §2 endpoint table**

```markdown
| `GET /v1/insights/{id}` | `recordInsight`/`getInsight` (`services/insight-delivery`) | Platforms, agents | One gate-cleared Insight: statement, domain, evidence, `valid_until`, classification-filtered |
| `GET /v1/insights/search` | `searchInsights` (`services/insight-delivery`) | Platforms, agents | Insights matching domain/scope/platform filters, most-recent-first |
```

- [ ] **Step 2: Add the two nodes to the §1 Mermaid surface map**

In the `Read` subgraph, add:

```
        INS["GET /v1/insights/*<br/>gate-cleared findings"]
```

And add the edges `PL --> INS` and `AG --> INS` alongside the existing `PL --> Q` / `AG --> Q` lines.

- [ ] **Step 3: Update the document's opening claim**

Change the sentence "The brain's only other output channel is the PR Generator ([brain.workflows.md](brain.workflows.md) §6), which is not an API — nothing external can command it." to:

```markdown
The brain's other output channels are the PR Generator ([brain.workflows.md](brain.workflows.md) §6, structural changes only) and Notify-routed Insight delivery ([ADR-0017](adr/ADR-0017-outbound-insight-delivery.md), informational only) — neither is directly commandable; the read surface above is the only thing external callers can ask for.
```

- [ ] **Step 4: Verify**

Run: `grep -n "v1/insights" brain.api.md`
Expected: at least 4 matches (mermaid node, mermaid edges ×2, endpoint table rows ×2 — 5+ matches total).

- [ ] **Step 5: Commit**

```bash
git add brain.api.md
git commit -m "docs(brain.api): add /v1/insights/* read surface"
```

---

### Task 8: `brain.architecture.md` — two outbound paths

**Files:**
- Modify: `brain.architecture.md` (§2 "Layer model", §3 "Component responsibilities")

- [ ] **Step 1: Update the §2 diagram label**

Change the Mermaid node `PRGEN[PR Generator<br/>the ONLY outbound path]` to:

```
PRGEN[PR Generator<br/>outbound path 1: structural change]
```

and add a sibling node in the same subgraph:

```
INSDEL[Insight Delivery<br/>outbound path 2: Notify-routed]
```

- [ ] **Step 2: Add the component table row**

In §3's component table, directly under the existing `PR Generator` row, add:

```markdown
| Insight Delivery | Classify conclusions, run Ethics/Security gates, record gate-cleared Insights to Dot.Memory, deliver push via Dot.Notify | [docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md](docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md), [ADR-0017](adr/ADR-0017-outbound-insight-delivery.md) | Architecture, reference implementation `services/insight-delivery` |
```

- [ ] **Step 3: Verify**

Run: `grep -n "Insight Delivery" brain.architecture.md`
Expected: 2 matches (diagram node label text, table row).

- [ ] **Step 4: Commit**

```bash
git add brain.architecture.md
git commit -m "docs(brain.architecture): document the second outbound path (Insight Delivery)"
```

---

### Task 9: New ADR-0017

**Files:**
- Create: `adr/ADR-0017-outbound-insight-delivery.md`

- [ ] **Step 1: Write the ADR**, following the exact section structure of `adr/ADR-0015-three-platform-intelligence-loop.md` (Status / Context / Decision / Consequences / Alternatives considered / Change log / Open questions):

```markdown
---
title: ADR-0017 — Outbound Insight Delivery via Pull API and Notify-Routed Push
version: 1.0.0
status: active
owners: [Chief Architect]
last-review: 2026-09-19
---

# ADR-0017 — Outbound Insight Delivery via Pull API and Notify-Routed Push

Purpose: record the decision to give Dot.Brain a second outbound path — a gate-cleared, non-structural Insight — and specifically why push delivery is routed through Dot.Notify rather than built as new infrastructure inside Dot.Brain.

> **Related documents:** [docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md](../docs/superpowers/specs/2026-09-19-outbound-insight-delivery-design.md) — the full design · [ADR-0015-three-platform-intelligence-loop.md](ADR-0015-three-platform-intelligence-loop.md) — the envelope this reuses, and the duplication precedent this ADR follows · [../brain.workflows.md](../brain.workflows.md) §4–5 · [../brain.api.md](../brain.api.md) · [../platforms/dot-notify.md](../platforms/dot-notify.md) · [../services/insight-delivery](../services/insight-delivery/README.md) — reference implementation.

---

## Status

Accepted — 2026-09-19

## Context

Dot.Brain's only outbound path was the PR Generator, scoped exclusively to structural changes a platform reviews and merges. There was no path for Brain to surface a purely informational, time-relevant finding — and the ecosystem's stated product direction (Dot.Brain as an always-on intelligence engine that *feeds* every platform, not only one that platforms poll or that only writes back via PR) requires one.

Dot.Notify already exists as "the shared last mile — delivery of alerts, digests, and messages on behalf of every other platform" (`platforms/dot-notify.md` §1), with consent, channel selection, precision-gating, and fatigue throttling already built and running in production. ADR-0015 already rejected a comparable duplication — Dopemine as a general execution/delivery layer — on exactly this principle.

## Decision

1. **Two outbound paths, not three.** Structural changes still go only through the PR Generator, unchanged. A new, narrower path — Insight Delivery — handles informational content. No third, bespoke channel is built.
2. **Pull is owned by Brain.** `GET /v1/insights/{id}` and `GET /v1/insights/search` follow the existing Query API's exact conventions (auth, classification filtering, versioning).
3. **Push is routed through Dot.Notify, not built by Brain.** Brain emits an ADR-0015 intelligence-loop `action` envelope with `executor_platform: "dot-notify"`; Notify owns channel selection, consent, and throttling, exactly as it already does for every other platform.
4. **Insight candidates pass Ethics and Security, and skip Governance.** Nothing is applied to a platform by an Insight, so there is no decision-rights question — the same principle that lets Query API reads skip Governance today.
5. **The outcome stage reuses Notify's existing delivery events.** `messaging.delivery.acted/ignored` already carries what the intelligence-loop's `outcome` stage needs; no new outcome-tracking mechanism is introduced.

## Consequences

- Dot.Notify's existing consent and throttling model now also governs Insight delivery, for free — Brain inherits that maturity instead of re-implementing a weaker version of it.
- `insight.schema.json` gains a second producer (Brain itself, not only platforms publishing in) without any schema change.
- A future platform that wants Insights only needs to implement the pull surface; push is opt-in via its existing Notify integration.
- Brain's architecture invariant changes from "one outbound path" to "two outbound paths, each narrowly scoped" — `brain.architecture.md` §2–3 updated accordingly.

## Alternatives considered

- **A bespoke Brain-owned webhook/subscription system.** Rejected: duplicates Dot.Notify's exact job, the specific anti-pattern ADR-0015 already named and rejected for Dopemine.
- **Push-only, no pull surface.** Rejected: forces every platform to integrate Notify just to see Insights at all, with no fallback when a webhook endpoint is down.
- **Routing Insights through the intelligence-loop's risk/confidence `reason()` gate** (the same gate that decides autonomous remediation). Rejected: that gate models whether Brain may autonomously perform a *consequential* action based on a subject's track record; an Insight has already been vetted by Ethics/Security at classification time, and forcing it through an unrelated confidence gate would mean a brand-new `action_kind` with no track record could never autonomously deliver, contradicting the whole point of the design.

---

## Change log

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0.0 | 2026-09-19 | Brainstorming/planning session | Initial decision record. |

## Open questions

- Should a platform be able to opt out of push delivery entirely (pull-only), or is that already covered by Notify's existing consent model at the recipient level?
- Does `insight.deliver` need its own rate limit (mirroring the PR Generator's per-platform PR budget), or is Notify's existing fatigue throttling sufficient on its own?
```

- [ ] **Step 2: Verify the ADR is reachable**

Run: `grep -n "ADR-0017" brain.architecture.md brain.api.md services/insight-delivery/README.md`
Expected: at least one match per file (confirms Tasks 5, 7, 8 already link to it — if any is missing, add the link now).

- [ ] **Step 3: Commit**

```bash
git add adr/ADR-0017-outbound-insight-delivery.md
git commit -m "docs(adr): add ADR-0017, outbound Insight delivery via pull API and Notify-routed push"
```

---

### Task 10: `platforms/dot-notify.md` and `README.md`

**Files:**
- Modify: `platforms/dot-notify.md` (the "Intelligence Consumed" section)
- Modify: `README.md` (the "What Dot.Brain IS" bullet list)

- [ ] **Step 1: Add the new consumed type to `platforms/dot-notify.md`**

In §5 "Intelligence Consumed", add a row to the existing table:

```markdown
| `insight.deliver` action (ADR-0017) | Delivery reach for a gate-cleared Insight, via Notify's existing channel/consent/precision logic | New — 2026-09-19 |
```

If the table's header columns don't match this shape (verify against the file before editing — the existing table used `Recommendation type | Metric expected to move | Baseline`), add a short paragraph immediately after the table instead:

```markdown
Notify also consumes one non-Recommendation input: an `insight.deliver` action from Dot.Brain's Insight Delivery path (ADR-0017), routed through Notify's existing channel selection, consent, and precision-gating exactly as any other platform's alert is. See [ADR-0017](../adr/ADR-0017-outbound-insight-delivery.md).
```

- [ ] **Step 2: Add the one-line addition to `README.md`**

In the "What Dot.Brain IS" bullet list, add a new bullet directly after the existing "reasoning and recommendation engine" bullet:

```markdown
- The **Insight Delivery** path — gate-cleared, non-structural findings served on demand via a pull API and, for platforms that want real-time delivery, pushed through Dot.Notify's existing infrastructure ([ADR-0017](adr/ADR-0017-outbound-insight-delivery.md)).
```

- [ ] **Step 3: Verify both files updated correctly**

Run: `grep -n "ADR-0017" README.md platforms/dot-notify.md`
Expected: one match in each file.

- [ ] **Step 4: Commit**

```bash
git add platforms/dot-notify.md README.md
git commit -m "docs: cross-link Insight Delivery from dot-notify platform doc and README"
```

---

## Final verification

- [ ] Run the full new service's test suite: `cd services/insight-delivery && npm test` — expect all tests passing (23 tests across 4 files: 4 classify + 7 gates + 8 memory-client + 4 deliver).
- [ ] Confirm no other service's files were touched: `git diff --stat main -- services/` should show only `services/insight-delivery/` as new, nothing else modified.
- [ ] Confirm every doc cross-reference resolves to a real path: `grep -rn "insight-delivery\|ADR-0017" brain.*.md README.md platforms/dot-notify.md adr/ | wc -l` should be ≥ 8 (one or more per Task 6–10 file).

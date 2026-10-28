import { createHash } from 'node:crypto';
import { SCHEMA_VERSION, STATUSES, ERROR_CATEGORIES, CONSENT_BASES, EVENT_TYPES, LIMITS, TOP_LEVEL, REQUIRED } from './taxonomy.js';
import { forbiddenReason } from './forbidden.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const PRODUCT = /^[a-z][a-z0-9-]{1,31}$/;
const SESSION = /^ps_[0-9a-f]{16,64}$/;
const NAME = /^[a-z][a-z0-9_.-]{1,63}$/;
const ERROR_CODE = /^[a-z0-9_]{1,40}$/;
const ROUTE = /^\/[A-Za-z0-9_\-/{}.:]{0,119}$/;
const ID_LIKE_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27}|[0-9a-f]{16,})$/i;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

/**
 * Validate one event. Returns { ok, reasons } where each reason is { path, code }.
 * Reasons never contain the offending value, so a rejection log cannot leak what it rejected.
 */
export function validateEvent(event, { now = Date.now() } = {}) {
  const reasons = [];
  const fail = (path, code) => reasons.push({ path, code });

  if (!isObj(event)) return { ok: false, reasons: [{ path: '', code: 'not_an_object' }] };

  let size = 0;
  try { size = Buffer.byteLength(JSON.stringify(event)); } catch { fail('', 'not_serialisable'); }
  if (size > LIMITS.maxEventBytes) fail('', 'event_too_large');

  for (const key of Object.keys(event)) if (!TOP_LEVEL.includes(key)) fail(key, 'unknown_field');
  for (const key of REQUIRED) if (event[key] === undefined) fail(key, 'missing_required');

  // Free-form strings are scanned for forbidden content first. Strictly formatted identifiers are exempt from the
  // token detector (a UUID or session id is token-shaped by design) because their format check is stricter.
  const exempt = new Set(['event_id', 'session', 'tenant', 'occurred_at']);
  const scan = (value, path, top) => {
    if (typeof value === 'string') {
      if (top && exempt.has(top)) return;
      const code = forbiddenReason(value);
      if (code) fail(path, code);
    } else if (Array.isArray(value)) {
      fail(path, 'array_not_allowed');
    } else if (isObj(value)) {
      for (const [k, v] of Object.entries(value)) scan(v, `${path}.${k}`, null);
    }
  };
  for (const [k, v] of Object.entries(event)) scan(v, k, k);

  if (event.event_id !== undefined && !(typeof event.event_id === 'string' && UUID.test(event.event_id))) fail('event_id', 'bad_format');

  if (event.occurred_at !== undefined) {
    if (typeof event.occurred_at !== 'string' || !ISO_UTC.test(event.occurred_at) || Number.isNaN(Date.parse(event.occurred_at))) {
      fail('occurred_at', 'bad_format');
    } else {
      const t = Date.parse(event.occurred_at);
      if (t - now > LIMITS.maxFutureMs) fail('occurred_at', 'in_the_future');
      if (now - t > LIMITS.maxAgeMs) fail('occurred_at', 'too_old');
    }
  }

  if (event.schema_version !== undefined && event.schema_version !== SCHEMA_VERSION) fail('schema_version', 'unsupported_version');
  if (event.product !== undefined && !(typeof event.product === 'string' && PRODUCT.test(event.product))) fail('product', 'bad_format');
  if (event.tenant !== undefined && !(typeof event.tenant === 'string' && UUID.test(event.tenant))) fail('tenant', 'bad_format');
  if (event.session !== undefined && !(typeof event.session === 'string' && SESSION.test(event.session))) fail('session', 'bad_format');
  if (event.name !== undefined && !(typeof event.name === 'string' && NAME.test(event.name))) fail('name', 'bad_format');
  if (event.instrument !== undefined && !(typeof event.instrument === 'string' && NAME.test(event.instrument))) fail('instrument', 'bad_format');

  if (event.route !== undefined) {
    if (typeof event.route !== 'string' || !ROUTE.test(event.route)) fail('route', 'bad_format');
    else if (event.route.split('/').some((seg) => ID_LIKE_SEGMENT.test(seg))) fail('route', 'contains_identifier_segment');
  }

  if (event.status !== undefined && !STATUSES.includes(event.status)) fail('status', 'not_in_enum');

  const def = EVENT_TYPES[event.type];
  if (event.type !== undefined && !def) fail('type', 'unknown_type');

  if (def) {
    if (event.status !== undefined && STATUSES.includes(event.status) && !def.statuses.includes(event.status)) fail('status', 'status_not_allowed_for_type');
    for (const block of ['perf', 'error', 'counts', 'flags']) {
      if (event[block] !== undefined && !def.blocks.includes(block)) fail(block, 'block_not_allowed_for_type');
    }
    if (def.needsWorkflow && event.workflow === undefined) fail('workflow', 'missing_required');
    if (!def.needsWorkflow && event.workflow !== undefined && !event.type.startsWith('workflow.') && event.type !== 'goal.complete') {
      // Other events may be tagged with a workflow they sit inside; keep it optional but structurally checked below.
    }
  }

  if (event.workflow !== undefined) {
    const w = event.workflow;
    if (!isObj(w)) fail('workflow', 'bad_format');
    else {
      for (const k of Object.keys(w)) if (!['id', 'step', 'seq'].includes(k)) fail(`workflow.${k}`, 'unknown_field');
      if (!(typeof w.id === 'string' && NAME.test(w.id))) fail('workflow.id', 'bad_format');
      if (w.step !== undefined && !(typeof w.step === 'string' && NAME.test(w.step))) fail('workflow.step', 'bad_format');
      if (w.seq !== undefined && !isInt(w.seq, 1000)) fail('workflow.seq', 'out_of_range');
    }
  }

  if (event.perf !== undefined) {
    const p = event.perf;
    if (!isObj(p)) fail('perf', 'bad_format');
    else for (const [k, v] of Object.entries(p)) {
      if (!['duration_ms', 'ttfb_ms', 'render_ms'].includes(k)) fail(`perf.${k}`, 'unknown_field');
      else if (!isInt(v, LIMITS.maxDurationMs)) fail(`perf.${k}`, 'out_of_range');
    }
  }

  if (event.error !== undefined) {
    const e = event.error;
    if (!isObj(e)) fail('error', 'bad_format');
    else {
      for (const k of Object.keys(e)) if (!['category', 'code'].includes(k)) fail(`error.${k}`, 'unknown_field');
      if (!ERROR_CATEGORIES.includes(e.category)) fail('error.category', 'not_in_enum');
      if (e.code !== undefined && !(typeof e.code === 'string' && ERROR_CODE.test(e.code))) fail('error.code', 'bad_format');
    }
  }

  if (event.counts !== undefined) {
    const c = event.counts;
    const allowed = def?.counts ?? [];
    if (!isObj(c)) fail('counts', 'bad_format');
    else for (const [k, v] of Object.entries(c)) {
      if (!allowed.includes(k)) fail(`counts.${k}`, 'count_not_allowed_for_type');
      else if (!isInt(v, LIMITS.maxCount)) fail(`counts.${k}`, 'out_of_range');
    }
  }

  if (event.flags !== undefined) {
    const f = event.flags;
    const allowed = def?.flags ?? [];
    if (!isObj(f)) fail('flags', 'bad_format');
    else for (const [k, v] of Object.entries(f)) {
      if (!allowed.includes(k)) fail(`flags.${k}`, 'flag_not_allowed_for_type');
      else if (typeof v !== 'boolean') fail(`flags.${k}`, 'bad_format');
    }
  }

  if (event.consent !== undefined) {
    const c = event.consent;
    if (!isObj(c)) fail('consent', 'bad_format');
    else {
      for (const k of Object.keys(c)) if (k !== 'basis') fail(`consent.${k}`, 'unknown_field');
      if (!CONSENT_BASES.includes(c.basis)) fail('consent.basis', 'not_in_enum');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/** Idempotency key: the same event retried or replayed maps to the same key and is stored once. */
export function idempotencyKey(event) {
  return createHash('sha256').update(`${event.product}\u0000${event.event_id}`).digest('hex');
}

/**
 * Validate a batch. Rejects the whole batch when it is oversized or not an array; otherwise accepts the good events and
 * returns a reason-coded rejection per bad one. Duplicates inside the batch (same idempotency key) are dropped, not errors.
 */
export function validateBatch(events, options = {}) {
  if (!Array.isArray(events)) return { ok: false, batchError: 'not_an_array', accepted: [], rejected: [], duplicates: 0 };
  if (events.length === 0) return { ok: false, batchError: 'empty_batch', accepted: [], rejected: [], duplicates: 0 };
  if (events.length > LIMITS.maxBatch) return { ok: false, batchError: 'batch_too_large', accepted: [], rejected: [], duplicates: 0 };

  const accepted = [];
  const rejected = [];
  const seen = new Set();
  let duplicates = 0;
  events.forEach((event, index) => {
    const result = validateEvent(event, options);
    if (!result.ok) { rejected.push({ index, reasons: result.reasons }); return; }
    const key = idempotencyKey(event);
    if (seen.has(key)) { duplicates += 1; return; }
    seen.add(key);
    accepted.push({ key, event });
  });
  return { ok: rejected.length === 0, accepted, rejected, duplicates };
}

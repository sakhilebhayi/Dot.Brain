import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEvent, validateBatch, idempotencyKey, forbiddenReason, luhn, looksLikeSaId, EVENT_TYPES, LIMITS, TOP_LEVEL } from '../src/index.js';

const NOW = Date.parse('2026-10-28T12:00:00Z');
const ev = (over = {}) => ({
  event_id: '0b6f3a52-5d2e-4c6e-9a3b-6d1f5b2c8e41',
  occurred_at: '2026-10-28T11:59:30Z',
  schema_version: '1.0.0',
  product: 'infodot',
  session: 'ps_0123456789abcdef0123',
  type: 'ui.click',
  name: 'ask_question_button',
  route: '/questions/{question}',
  status: 'success',
  consent: { basis: 'legitimate_interest' },
  ...over,
});
const check = (e) => validateEvent(e, { now: NOW });
const codes = (e) => check(e).reasons.map((r) => `${r.path}:${r.code}`);

// A SA ID with a valid date and Luhn check digit, built here so no real person's number is in the repository.
function makeSaId() {
  const body = '9001015009087'.slice(0, 12);
  for (let d = 0; d <= 9; d += 1) if (looksLikeSaId(body + d)) return body + d;
  throw new Error('no check digit');
}

test('a minimal valid event passes', () => {
  assert.deepEqual(check(ev()), { ok: true, reasons: [] });
});

test('every type in the taxonomy has a status it can carry', () => {
  for (const [type, def] of Object.entries(EVENT_TYPES)) {
    assert.ok(def.statuses.length > 0, type);
  }
});

test('missing required fields are reported by path', () => {
  const { event_id, session, ...rest } = ev();
  assert.deepEqual(codes(rest).sort(), ['event_id:missing_required', 'session:missing_required']);
});

test('unknown top-level fields are refused (no free-form payload)', () => {
  assert.deepEqual(codes(ev({ user_email: 'x' })), ['user_email:unknown_field']);
  assert.deepEqual(codes(ev({ payload: { a: 1 } })), ['payload:unknown_field']);
});

test('unknown type and wrong status for type', () => {
  assert.deepEqual(codes(ev({ type: 'ui.hover' })), ['type:unknown_type']);
  assert.deepEqual(codes(ev({ type: 'form.complete', status: 'failure' })), ['status:status_not_allowed_for_type']);
});

test('blocks only where the type allows them', () => {
  assert.deepEqual(codes(ev({ perf: { duration_ms: 10 } })), ['perf:block_not_allowed_for_type']);
  const ok = ev({ type: 'form.submit', status: 'failure', perf: { duration_ms: 420 }, error: { category: 'validation', code: 'required_missing' } });
  assert.equal(check(ok).ok, true);
});

test('workflow events need a workflow block', () => {
  assert.deepEqual(codes(ev({ type: 'workflow.step', status: 'success' })), ['workflow:missing_required']);
  const ok = ev({ type: 'workflow.step', status: 'success', workflow: { id: 'ask_question', step: 'compose', seq: 2 } });
  assert.equal(check(ok).ok, true);
});

test('search events carry lengths and counts, never the query', () => {
  const ok = ev({ type: 'search.run', status: 'success', counts: { query_length: 14, results_count: 3 }, flags: { reformulated: true } });
  assert.equal(check(ok).ok, true);
  assert.deepEqual(codes({ ...ok, query: 'how do I' }), ['query:unknown_field']);
  assert.deepEqual(codes({ ...ok, counts: { query_length: 14, query: 5 } }), ['counts.query:count_not_allowed_for_type']);
});

test('routes must be templates: no query string, no ids', () => {
  assert.deepEqual(codes(ev({ route: '/search?q=term' })), ['route:forbidden_url_or_query', 'route:bad_format']);
  assert.deepEqual(codes(ev({ route: '/questions/12345' })), ['route:contains_identifier_segment']);
  assert.deepEqual(codes(ev({ route: '/users/3f2c9a14-8b7d-4e01-a5c6-2d9e7f1b0a33' })), ['route:forbidden_token', 'route:contains_identifier_segment']);
  assert.equal(check(ev({ route: '/questions/{question}/solutions' })).ok, true);
});

test('time window: not future, not stale', () => {
  assert.deepEqual(codes(ev({ occurred_at: '2026-10-28T12:30:00Z' })), ['occurred_at:in_the_future']);
  assert.deepEqual(codes(ev({ occurred_at: '2026-10-01T00:00:00Z' })), ['occurred_at:too_old']);
  assert.deepEqual(codes(ev({ occurred_at: '2026-10-28 11:59:30' })), ['occurred_at:bad_format']);
});

test('session must be pseudonymous, tenant must be a uuid', () => {
  assert.deepEqual(codes(ev({ session: 'user-42' })), ['session:bad_format']);
  assert.deepEqual(codes(ev({ session: 'ps_xyz' })), ['session:bad_format']);
  assert.deepEqual(codes(ev({ tenant: 'acme' })), ['tenant:bad_format']);
});

test('personal data in any free string is rejected, with a code and without the value', () => {
  const cases = [
    [{ name: 'a@b.co' }, 'forbidden_email'],
    [{ error: { category: 'client', code: 'x' }, type: 'error.shown', status: 'failure', name: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc12' }, 'forbidden_token'],
    [{ name: 'sk_live_' + 'a'.repeat(40) }, 'forbidden_token'],
    [{ name: 'https://x.test/a' }, 'forbidden_url_or_query'],
    [{ name: '4242 4242 4242 4242' }, 'forbidden_card_number'],
    [{ name: makeSaId() }, 'forbidden_national_id'],
    [{ name: '+27 82 123 4567' }, 'forbidden_phone'],
    [{ name: '082 123 4567' }, 'forbidden_phone'],
  ];
  for (const [over, code] of cases) {
    const result = check(ev(over));
    assert.equal(result.ok, false, JSON.stringify(Object.keys(over)));
    assert.ok(result.reasons.some((r) => r.code === code), `${code} in ${JSON.stringify(result.reasons)}`);
    const text = JSON.stringify(result.reasons);
    for (const v of Object.values(over)) if (typeof v === 'string') assert.ok(!text.includes(v), 'reasons must not echo the value');
  }
});

test('the detectors leave ordinary identifiers alone', () => {
  assert.equal(forbiddenReason('ask_question_button'), null);
  assert.equal(forbiddenReason('/questions/{question}/solutions'), null);
  assert.equal(forbiddenReason('2026-10-28'), null);
  assert.equal(forbiddenReason('12345678'), null);
});

test('luhn and id helpers', () => {
  assert.equal(luhn('4242424242424242'), true);
  assert.equal(luhn('4242424242424241'), false);
  assert.equal(looksLikeSaId(makeSaId()), true);
  assert.equal(looksLikeSaId('9013015009087'), false);
});

test('numeric ranges and size', () => {
  assert.deepEqual(codes(ev({ type: 'request.slow', status: 'partial', perf: { duration_ms: -1 } })), ['perf.duration_ms:out_of_range']);
  assert.deepEqual(codes(ev({ type: 'request.slow', status: 'partial', perf: { duration_ms: 1.5 } })), ['perf.duration_ms:out_of_range']);
  assert.deepEqual(codes(ev({ type: 'request.slow', status: 'partial', perf: { duration_ms: LIMITS.maxDurationMs + 1 } })), ['perf.duration_ms:out_of_range']);
  const big = ev({ type: 'form.submit', status: 'failure', error: { category: 'validation', code: 'x'.repeat(1) } });
  big.name = 'a'.repeat(3000);
  assert.ok(codes(big).includes(':event_too_large'));
});

test('arrays and non-objects are refused', () => {
  assert.deepEqual(check(null).reasons, [{ path: '', code: 'not_an_object' }]);
  assert.deepEqual(check([]).reasons, [{ path: '', code: 'not_an_object' }]);
  assert.ok(codes(ev({ perf: [1] })).includes('perf:array_not_allowed'));
});

test('batch: limits, per-event rejection, de-duplication', () => {
  assert.equal(validateBatch('x').batchError, 'not_an_array');
  assert.equal(validateBatch([]).batchError, 'empty_batch');
  assert.equal(validateBatch(new Array(LIMITS.maxBatch + 1).fill(ev())).batchError, 'batch_too_large');

  const a = ev();
  const b = ev({ event_id: '1c7f4b63-6e3f-4d7f-8b4c-7e2a6c3d9f52' });
  const bad = ev({ type: 'nope' });
  const result = validateBatch([a, a, b, bad], { now: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.accepted.length, 2);
  assert.equal(result.duplicates, 1);
  assert.deepEqual(result.rejected.map((r) => r.index), [3]);
});

test('idempotency key is stable per product and event id', () => {
  assert.equal(idempotencyKey(ev()), idempotencyKey(ev({ name: 'other_name' })));
  assert.notEqual(idempotencyKey(ev()), idempotencyKey(ev({ product: 'dopemine' })));
  assert.match(idempotencyKey(ev()), /^[0-9a-f]{64}$/);
});

test('the published JSON schema lists exactly the taxonomy types, statuses, error categories and consent bases', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const schema = JSON.parse(readFileSync(fileURLToPath(new URL('../../../schemas/ux-interaction-event.schema.json', import.meta.url)), 'utf8'));
  const { STATUSES, ERROR_CATEGORIES, CONSENT_BASES, SCHEMA_VERSION } = await import('../src/index.js');
  assert.deepEqual(schema.properties.type.enum, Object.keys(EVENT_TYPES));
  assert.deepEqual(schema.properties.status.enum, STATUSES);
  assert.deepEqual(schema.properties.error.properties.category.enum, ERROR_CATEGORIES);
  assert.deepEqual(schema.properties.consent.properties.basis.enum, CONSENT_BASES);
  assert.equal(schema.properties.schema_version.const, SCHEMA_VERSION);
  assert.deepEqual(Object.keys(schema.properties).sort(), [...TOP_LEVEL].sort());
});

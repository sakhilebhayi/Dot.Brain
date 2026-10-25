import test from 'node:test';
import assert from 'node:assert/strict';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, WINDOW_SECONDS, sign, signedHeaders, verify } from '../src/hmac.js';

// Vectors generated independently with openssl:
//   printf '1700000000.' | openssl dgst -sha256 -hmac 'test-secret'
test('known vectors: a GET signs "{timestamp}." (empty body)', () => {
  assert.equal(sign('test-secret', 1700000000), 'sha256=02135fb92b9e5ac01b6ffb10fb1ce695acf10403dc760ecd132a9fd9d96d71d1');
  assert.equal(sign('test-secret', '1700000000', ''), 'sha256=02135fb92b9e5ac01b6ffb10fb1ce695acf10403dc760ecd132a9fd9d96d71d1');
  assert.equal(sign('k', 1234567890), 'sha256=a6c8e295747cc3825eb3208e400637cb6948e0ca11765c89111ffea74a44e7a6');
});

test('known vector with a body signs "{timestamp}.{body}"', () => {
  assert.equal(sign('test-secret', 1700000000, '{"a":1}'), 'sha256=8cb2c3355fca388e9ac2caec004f4d5d7045d74937ab5faad61dc11682247a9f');
});

test('the trailing dot matters', () => {
  assert.notEqual(sign('test-secret', 1700000000), 'sha256=' + 'x');
  // "1700000000" without the dot would be a different message entirely.
  assert.notEqual(sign('test-secret', 1700000000, 'x'), sign('test-secret', 1700000000));
});

test('signedHeaders floors the clock to unix seconds and uses the contract header names', () => {
  const h = signedHeaders('test-secret', { now: new Date(1700000000999) });
  assert.deepEqual(Object.keys(h), [TIMESTAMP_HEADER, SIGNATURE_HEADER]);
  assert.equal(TIMESTAMP_HEADER, 'X-InfoDot-Timestamp');
  assert.equal(SIGNATURE_HEADER, 'X-InfoDot-Signature');
  assert.equal(h['X-InfoDot-Timestamp'], '1700000000');
  assert.equal(h['X-InfoDot-Signature'], 'sha256=02135fb92b9e5ac01b6ffb10fb1ce695acf10403dc760ecd132a9fd9d96d71d1');
  assert.deepEqual(signedHeaders('test-secret', { now: 1700000000999 }), h);
});

test('an empty secret is refused rather than silently signing with nothing', () => {
  assert.throws(() => sign('', 1), /empty/);
  assert.throws(() => sign(undefined, 1), /empty/);
});

test('verify accepts a good signature inside the 300 s window and rejects outside it', () => {
  const sig = sign('test-secret', 1700000000);
  const ok = (nowS) => verify('test-secret', { timestamp: '1700000000', signature: sig, now: nowS * 1000 });
  assert.equal(WINDOW_SECONDS, 300);
  assert.equal(ok(1700000000), true);
  assert.equal(ok(1700000300), true);
  assert.equal(ok(1700000301), false);
  assert.equal(ok(1699999700), true);
  assert.equal(ok(1699999699), false);
});

test('verify rejects a wrong secret, tampered body, malformed or missing parts', () => {
  const sig = sign('test-secret', 1700000000);
  const base = { timestamp: '1700000000', signature: sig, now: 1700000000_000 };
  assert.equal(verify('other-secret', base), false);
  assert.equal(verify('test-secret', { ...base, body: 'x' }), false);
  assert.equal(verify('test-secret', { ...base, signature: sig.slice(0, -1) }), false);
  assert.equal(verify('test-secret', { ...base, signature: undefined }), false);
  assert.equal(verify('test-secret', { ...base, timestamp: 'abc' }), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { tokenFor, pollPlatform } from '../src/client.js';

const MANIFEST = {
  platform: 'dot-billing',
  signals_url: 'https://billing.dot/revenue/signals',
  token_env: 'DOT_BILLING_REVENUE_TOKEN',
  poll_interval_s: 3600,
  timeout_ms: 15000,
  classification_ceiling: 'restricted',
};

const VALID_BODY = {
  platform: 'dot-billing',
  contract: 'dot-revenue/v1',
  generated_at: '2026-09-23T10:00:00Z',
  classification: 'restricted',
  signals: [{ key: 'revenue.mrr', value: 48210.55, unit: 'usd' }],
};

test('tokenFor reads the manifest-declared env var', () => {
  assert.equal(tokenFor(MANIFEST, { DOT_BILLING_REVENUE_TOKEN: 'tok-123' }), 'tok-123');
});

test('tokenFor returns null when the env var is unset', () => {
  assert.equal(tokenFor(MANIFEST, {}), null);
});

test('pollPlatform fails closed with kind auth when the token is missing, before any fetch', async () => {
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: {} });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'auth');
  assert.match(result.reason, /DOT_BILLING_REVENUE_TOKEN/);
  assert.equal(fetchCalled, false);
});

test('pollPlatform sends the bearer token and returns signals on success', async () => {
  let receivedUrl;
  let receivedHeaders;
  const fetchImpl = async (url, options) => {
    receivedUrl = url;
    receivedHeaders = options.headers;
    return { ok: true, json: async () => VALID_BODY };
  };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, true);
  assert.equal(result.platform, 'dot-billing');
  assert.equal(result.classification, 'restricted');
  assert.deepEqual(result.signals, VALID_BODY.signals);
  assert.equal(receivedUrl, MANIFEST.signals_url);
  assert.equal(receivedHeaders.Authorization, 'Bearer tok-123');
});

test('pollPlatform reports kind network on a non-ok HTTP status', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503 });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'network');
  assert.match(result.reason, /503/);
});

test('pollPlatform reports kind network when fetch itself throws', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'network');
  assert.match(result.reason, /ECONNREFUSED/);
});

test('pollPlatform reports kind contract when the response body is not valid JSON', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'contract');
  assert.match(result.reason, /response body is not valid JSON/);
});

test('pollPlatform reports kind contract on a malformed body', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, signals: 'nope' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'contract');
  assert.match(result.reason, /signals must be an array/);
});

test('pollPlatform reports kind classification_ceiling when the response exceeds the manifest ceiling', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, classification: 'sensitive' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'classification_ceiling');
  assert.match(result.reason, /exceeds this platform's ceiling/);
});

test('pollPlatform never returns the raw response body, only the extracted fields', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ...VALID_BODY, extra_internal_field: 'should not leak' }) });
  const result = await pollPlatform(MANIFEST, { fetchImpl, env: { DOT_BILLING_REVENUE_TOKEN: 'tok-123' } });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['classification', 'generated_at', 'ok', 'platform', 'signals']);
});

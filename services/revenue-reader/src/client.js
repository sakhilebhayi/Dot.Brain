import { validateSignalsResponse, classificationExceedsCeiling } from './contract.js';

/**
 * @param {object} manifest a validated manifest (registry.js)
 * @param {object} [env] process.env, injectable for tests
 * @returns {string|null}
 */
export function tokenFor(manifest, env = process.env) {
  return env[manifest.token_env] || null;
}

/**
 * One poll attempt against a platform's dot-revenue/v1 endpoint
 * (design spec §1, §4). Fails closed on a missing token before any
 * network call, mirroring Guardian's precedent. Never persists
 * anything and never returns more than the four extracted fields --
 * the caller decides what, if anything, to do with a successful result.
 *
 * @param {object} manifest a validated manifest (registry.js)
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {object} [opts.env]
 */
export async function pollPlatform(manifest, { fetchImpl = fetch, env = process.env } = {}) {
  const token = tokenFor(manifest, env);
  if (!token) {
    return { ok: false, platform: manifest.platform, kind: 'auth', reason: `${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.signals_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms),
    });
  } catch (error) {
    return { ok: false, platform: manifest.platform, kind: 'network', reason: error.message };
  }

  if (!response.ok) {
    return { ok: false, platform: manifest.platform, kind: 'network', reason: `HTTP ${response.status}` };
  }

  const body = await response.json();
  const validation = validateSignalsResponse(body);
  if (!validation.valid) {
    return { ok: false, platform: manifest.platform, kind: 'contract', reason: validation.reason };
  }

  if (classificationExceedsCeiling(body.classification, manifest.classification_ceiling)) {
    return {
      ok: false,
      platform: manifest.platform,
      kind: 'classification_ceiling',
      reason: `response classification "${body.classification}" exceeds this platform's ceiling "${manifest.classification_ceiling}"`,
    };
  }

  return {
    ok: true,
    platform: manifest.platform,
    generated_at: body.generated_at,
    classification: body.classification,
    signals: body.signals,
  };
}

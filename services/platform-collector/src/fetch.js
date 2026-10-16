// services/platform-collector/src/fetch.js
import { describeError } from './errors.js';

export const VALID_STATUSES = ['healthy', 'warning', 'critical', 'unknown'];

/**
 * Why a health fetch failed (ADR-0016), as services/guardian/src/health.js
 * implements it -- duplicated here per this repo's convention that every
 * service is self-contained. The words must keep meaning the same thing in
 * both places.
 *
 *   unreachable    -- nothing answered, or the answer never finished: DNS, connection refused, timeout (including a stalled body)
 *   platform_error -- answered with 5xx: the app is failing
 *   maintenance    -- answered 503: almost always our own deploy
 *   access         -- answered 401/403 (or another refusal): reached and refused
 *   config         -- 404, or no token: we are pointed at the wrong place
 *   contract       -- answered, but not with a dot-guardian/v1 document
 */
export const FAILURE_KINDS = ['unreachable', 'platform_error', 'maintenance', 'access', 'config', 'contract'];

function kindForStatus(status) {
  if (status === 401 || status === 403) return 'access';
  if (status === 404) return 'config';
  if (status === 503) return 'maintenance';
  if (status >= 500) return 'platform_error';
  return 'access';
}

/**
 * Fetch one platform's dot-guardian/v1 health document. Never throws: every
 * failure comes back as {reachable: false, kind, reason}. An unset token is
 * recorded as `config` rather than skipped -- a silent hole in an hourly
 * series is worse than a recorded one.
 *
 * @param {{platform: string, health_url: string, token_env: string, timeout_ms: number}} manifest
 * @param {{fetchImpl?: typeof fetch, env?: Record<string, string|undefined>}} [opts]
 */
export async function fetchHealth(manifest, { fetchImpl = fetch, env = process.env } = {}) {
  const token = env[manifest.token_env];
  if (!token) {
    return { reachable: false, kind: 'config', reason: `token env ${manifest.token_env} is not set` };
  }

  let response;
  try {
    response = await fetchImpl(manifest.health_url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(manifest.timeout_ms),
    });
  } catch (error) {
    return { reachable: false, kind: 'unreachable', reason: `fetch failed: ${describeError(error)}` };
  }

  if (response == null) {
    return { reachable: false, kind: 'unreachable', reason: 'fetch returned no response' };
  }

  if (!response.ok) {
    return { reachable: false, kind: kindForStatus(response.status), reason: `HTTP ${response.status}` };
  }

  let doc;
  try {
    doc = await response.json();
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      return { reachable: false, kind: 'unreachable', reason: `body read failed: ${describeError(error)}` };
    }
    return { reachable: false, kind: 'contract', reason: 'response body was not JSON' };
  }

  if (
    !doc
    || typeof doc.checks !== 'object'
    || doc.checks === null
    || Array.isArray(doc.checks)
    || !VALID_STATUSES.includes(doc.status)
  ) {
    return { reachable: false, kind: 'contract', reason: 'response did not match the dot-guardian/v1 contract' };
  }

  // Lenient on absence, strict on mismatch: a URL that answers for a different
  // platform (a mis-pointed manifest, a copied one) must not be recorded as this
  // platform's health.
  if (typeof doc.platform === 'string' && doc.platform !== manifest.platform) {
    return { reachable: false, kind: 'contract', reason: `document is for "${doc.platform.slice(0, 64)}", not "${manifest.platform}"` };
  }

  return {
    reachable: true,
    status: doc.status,
    generated_at: typeof doc.generated_at === 'string' ? doc.generated_at : null,
    checks: doc.checks,
  };
}

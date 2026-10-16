// services/platform-collector/src/memory.js
import { describeError } from './errors.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Statuses worth another attempt besides 5xx. 403 is here on evidence: ADR-0016
// measured ~6.6% of requests from GitHub runner IPs to this shared host being
// refused by the edge WAF (Dot.Memory lives on it), and the next attempt, a
// couple of seconds later, usually gets through. Treating it as terminal would
// turn ~1-2 runs a day red on WAF noise and teach the owner to ignore the red
// signal. 408 and 429 are the standard "try again" answers. Every other 4xx
// (400, 401, 404, 422...) means the request itself is wrong; retrying is futile.
const RETRYABLE_CLIENT_STATUSES = [403, 408, 429];

/**
 * Same shape as services/revenue-intelligence/src/memory-client.js:
 * DOT_MEMORY_URL + DOT_MEMORY_TOKEN, honest degradation (an unconfigured
 * Memory is reported, never treated as success).
 */
export function memoryConfig(env = process.env) {
  const url = env.DOT_MEMORY_URL;
  const token = env.DOT_MEMORY_TOKEN;

  return url && token
    ? { enabled: true, url: url.replace(/\/+$/, ''), token }
    : { enabled: false };
}

/**
 * POST one observation to Dot.Memory's intelligence events endpoint. Never
 * throws. Network errors, 5xx and 403/408/429 are retried after each delay in
 * `delaysMs` (an hour lost to one transient 502 or edge-WAF 403 is exactly the
 * staleness this job exists to prevent); any other 4xx means the record itself
 * is wrong, so retrying is futile.
 *
 * @param {{enabled: boolean, url?: string, token?: string}} cfg
 * @param {object} record
 * @param {{fetchImpl?: typeof fetch, sleep?: (ms: number) => Promise<void>, delaysMs?: number[]}} [opts]
 */
export async function writeObservation(cfg, record, { fetchImpl = fetch, sleep = defaultSleep, delaysMs = [2000, 5000] } = {}) {
  if (!cfg.enabled) {
    return { ok: false, reason: 'Dot.Memory is not configured' };
  }

  let reason = 'unknown failure';
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      const response = await fetchImpl(`${cfg.url}/api/intelligence/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(record),
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        return { ok: true, attempts: attempt + 1 };
      }
      reason = response.status === 403
        ? 'Dot.Memory answered HTTP 403 (likely the edge WAF, see ADR-0016)'
        : `Dot.Memory answered HTTP ${response.status}`;
      if (response.status < 500 && !RETRYABLE_CLIENT_STATUSES.includes(response.status)) {
        return { ok: false, reason, attempts: attempt + 1 };
      }
    } catch (error) {
      reason = `Dot.Memory request failed: ${describeError(error)}`;
    }

    if (attempt < delaysMs.length) {
      await sleep(delaysMs[attempt]);
    }
  }

  return { ok: false, reason, attempts: delaysMs.length + 1 };
}

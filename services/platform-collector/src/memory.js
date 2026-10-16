// services/platform-collector/src/memory.js

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Same shape as services/revenue-intelligence/src/memory-client.js and
 * services/blupin-context: DOT_MEMORY_URL + DOT_MEMORY_TOKEN, honest
 * degradation (an unconfigured Memory is reported, never treated as success).
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
 * throws. Network errors and 5xx are retried after each delay in `delaysMs`
 * (an hour lost to one transient 502 is exactly the staleness this job exists
 * to prevent); a 4xx means the record itself is wrong, so retrying is futile.
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
      reason = `Dot.Memory answered HTTP ${response.status}`;
      if (response.status < 500) {
        return { ok: false, reason, attempts: attempt + 1 };
      }
    } catch (error) {
      reason = `Dot.Memory request failed: ${error.message}`;
    }

    if (attempt < delaysMs.length) {
      await sleep(delaysMs[attempt]);
    }
  }

  return { ok: false, reason, attempts: delaysMs.length + 1 };
}

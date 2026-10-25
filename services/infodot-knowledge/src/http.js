// services/infodot-knowledge/src/http.js
import { redact } from './redact.js';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retried besides network errors and 5xx. 403 is here for the same measured
// reason as services/platform-collector (ADR-0016: ~6.6% of requests from
// GitHub runners to the shared host are refused by the edge WAF and the next
// attempt usually passes). 408/429 are the standard "try again". 401 and every
// other 4xx mean the request itself is wrong; retrying is futile.
const RETRYABLE = [403, 408, 429];

/**
 * One JSON request with a timeout and bounded retries. NEVER throws, and never
 * puts a header, token, secret or response body into its result: `reason` is a
 * short, redacted string; `code` is the server's error code, clipped.
 *
 * @param {object} o
 * @param {string} o.url
 * @param {() => Record<string,string>} o.headers   Called per attempt (fresh signature timestamp).
 * @param {'GET'|'POST'} [o.method]
 * @param {string} [o.body]
 * @param {string[]} [o.secrets]  Values to scrub from any reason text.
 * @returns {Promise<{ok: true, json: any, attempts: number} |
 *   {ok: false, kind: 'network'|'http'|'contract', status?: number, code?: string, reason: string, attempts: number}>}
 */
export async function requestJson({
  url,
  headers,
  method = 'GET',
  body,
  fetchImpl = fetch,
  sleep = defaultSleep,
  delaysMs = [2000, 5000],
  timeoutMs = 15000,
  secrets = [],
}) {
  let last = { ok: false, kind: 'network', reason: 'unknown failure', attempts: 0 };

  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    const attempts = attempt + 1;
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers() },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response == null) {
        last = { ok: false, kind: 'network', reason: 'no response', attempts };
      } else if (response.ok) {
        try {
          return { ok: true, json: await response.json(), attempts };
        } catch (error) {
          if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
            last = { ok: false, kind: 'network', reason: 'body read timed out', attempts };
          } else {
            return { ok: false, kind: 'contract', reason: 'response body was not JSON', attempts };
          }
        }
      } else {
        const code = await errorCode(response);
        last = {
          ok: false,
          kind: 'http',
          status: response.status,
          ...(code ? { code } : {}),
          reason: `HTTP ${response.status}${code ? ` (${code})` : ''}`,
          attempts,
        };
        if (response.status < 500 && !RETRYABLE.includes(response.status)) {
          return last;
        }
      }
    } catch (error) {
      last = { ok: false, kind: 'network', reason: redact(`request failed: ${describe(error)}`, secrets), attempts };
    }

    if (attempt < delaysMs.length) {
      await sleep(delaysMs[attempt]);
    }
  }

  return last;
}

// Servers answer errors as {code,message}. Only a short code is kept: the
// message is free text we neither need nor want in a log.
async function errorCode(response) {
  try {
    const doc = await response.json();
    return typeof doc?.code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(doc.code) ? doc.code : undefined;
  } catch {
    return undefined;
  }
}

function describe(error) {
  const message = String(error?.message ?? error);
  const cause = error?.cause?.code ?? error?.cause?.message;
  return cause ? `${message} (${String(cause)})` : message;
}

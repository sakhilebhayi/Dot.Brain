// services/infodot-knowledge/src/infodot.js
//
// Contract 1: GET {INFODOT_URL}/api/knowledge/candidates?since=<ISO>&limit=<n>
// HMAC-signed (see hmac.js). PUBLIC items only; no bodies, no emails. Even so,
// every item is reduced to the fields scoring needs: if InfoDot ever sent
// more, it is dropped here and never reaches a log or Dot.Memory.
import { signedHeaders } from './hmac.js';
import { requestJson } from './http.js';

export const EPOCH = '1970-01-01T00:00:00Z';
export const MAX_LIMIT = 100;
export const DEFAULT_MAX_PAGES = 50;

const KEEP = [
  'contribution_ref', 'kind', 'topics', 'created_at', 'edited_at',
  'accepted_by_independent', 'accepted_at', 'verified_by_independent', 'verified_at',
  'helpful_count', 'reuse_count', 'hidden', 'reversed',
];

/**
 * @returns {Promise<{ok: true, items: object[], pages: number, truncated: boolean, malformed: number} |
 *   {ok: false, stage: 'pull', kind: string, reason: string}>}
 */
export async function pullCandidates({
  baseUrl,
  secret,
  since = EPOCH,
  limit = MAX_LIMIT,
  maxPages = DEFAULT_MAX_PAGES,
  now = () => new Date(),
  fetchImpl = fetch,
  sleep,
  delaysMs,
  timeoutMs,
}) {
  const byRef = new Map();
  let malformed = 0;
  let cursor = since;
  let pages = 0;
  let truncated = false;

  while (true) {
    if (pages >= maxPages) {
      truncated = true;
      break;
    }

    const query = new URLSearchParams({ since: cursor, limit: String(limit) });
    const result = await requestJson({
      url: `${baseUrl}/api/knowledge/candidates?${query}`,
      headers: () => signedHeaders(secret, { now: now() }),
      fetchImpl,
      sleep,
      delaysMs,
      timeoutMs,
      secrets: [secret],
    });
    pages += 1;

    if (!result.ok) {
      return { ok: false, stage: 'pull', kind: result.kind, reason: `InfoDot candidates: ${result.reason}` };
    }

    const doc = result.json;
    const next = doc?.next_since;
    if (!doc || !Array.isArray(doc.items) || !(next === null || typeof next === 'string')) {
      return { ok: false, stage: 'pull', kind: 'contract', reason: 'InfoDot candidates: response did not match the contract' };
    }

    for (const raw of doc.items) {
      if (!raw || typeof raw !== 'object' || typeof raw.contribution_ref !== 'string' || raw.contribution_ref === ''
          || raw.contribution_ref.length > 200) {
        malformed += 1;
        continue;
      }
      byRef.set(raw.contribution_ref, Object.fromEntries(KEEP.filter((k) => k in raw).map((k) => [k, raw[k]])));
    }

    if (next === null) break;
    if (next === cursor) {
      // The server says "more" but gives no new position: stop rather than loop.
      truncated = true;
      break;
    }
    cursor = next;
  }

  return { ok: true, items: [...byRef.values()], pages, truncated, malformed };
}

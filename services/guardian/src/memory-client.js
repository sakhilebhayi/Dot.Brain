import { deleteMemoryOutbox, listMemoryOutbox, queueMemoryWrite } from './store.js';

/**
 * HTTP client for Dot.Memory's ops-memory API.
 *
 * Dot.Memory being down must never stop detection or remediation, so every
 * failed write lands in the local sqlite outbox and `guardian flush-memory`
 * (also run at the start of every poll) retries it. Recall failures
 * degrade to "no history" -- the decision engine just loses its
 * confidence bonus.
 */
export function memoryConfig(env = process.env) {
  const url = env.DOT_MEMORY_URL;
  const token = env.DOT_MEMORY_TOKEN;
  if (!url || !token) {
    return { enabled: false };
  }
  return { enabled: true, url: url.replace(/\/+$/, ''), token };
}

async function request(cfg, method, path, body, fetchImpl) {
  const response = await fetchImpl(`${cfg.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Dot.Memory answered HTTP ${response.status} for ${method} ${path}`);
  }
  return response.json();
}

/**
 * Translate one guardian incident row + extras into the ops-memory
 * incident record shape.
 */
export function toMemoryRecord(incident, manifest, extras = {}) {
  return {
    incident_uid: incident.incident_uid,
    platform: incident.platform,
    environment: manifest.environment ?? 'production',
    detection_source: 'guardian-health-poll',
    signature: incident.signature,
    component: incident.check_key,
    severity: incident.severity,
    status: incident.status,
    rollback_occurred: Boolean(extras.rollback_occurred),
    detected_at: incident.first_seen,
    resolved_at: incident.resolved_at ?? null,
    tests_result: extras.tests_result ?? null,
    deploy_result: extras.deploy_result ?? null,
    validation_result: extras.validation_result ?? null,
    record: {
      detail: safeParse(incident.detail),
      ...extras.record,
    },
  };
}

function safeParse(json) {
  try {
    return typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    return null;
  }
}

/**
 * Upsert one incident record; queues to the outbox on any failure.
 */
export async function record(cfg, store, memoryRecord, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { ok: false, queued: false, disabled: true };
  }
  try {
    await request(cfg, 'POST', '/api/ops/incidents', memoryRecord, fetchImpl);
    return { ok: true };
  } catch (error) {
    queueMemoryWrite(store, 'POST', '/api/ops/incidents', memoryRecord);
    return { ok: false, queued: true, reason: error.message };
  }
}

/**
 * Signature-recall for the decision engine. Failure degrades to zero
 * history rather than blocking the poll.
 */
export async function recall(cfg, { platform, signature }, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { matches: 0, unavailable: true };
  }
  try {
    const query = new URLSearchParams({ platform, signature }).toString();
    const payload = await request(cfg, 'GET', `/api/ops/recall?${query}`, undefined, fetchImpl);
    return payload.data ?? { matches: 0 };
  } catch (error) {
    return { matches: 0, unavailable: true, reason: error.message };
  }
}

/**
 * Retry every queued write, oldest first; stops at the first failure so
 * ordering is preserved.
 */
export async function flush(cfg, store, fetchImpl = fetch) {
  if (!cfg.enabled) {
    return { flushed: 0, remaining: listMemoryOutbox(store).length };
  }
  let flushed = 0;
  for (const entry of listMemoryOutbox(store)) {
    try {
      await request(cfg, entry.method, entry.path, JSON.parse(entry.body), fetchImpl);
      deleteMemoryOutbox(store, entry.id);
      flushed += 1;
    } catch {
      break;
    }
  }
  return { flushed, remaining: listMemoryOutbox(store).length };
}

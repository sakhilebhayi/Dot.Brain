// services/platform-collector/src/record.js
import { VALID_STATUSES } from './fetch.js';

const MAX_TEXT = 240;
const MAX_KEY = 80;
const MAX_METRIC_KEYS = 32;
const MAX_CHECKS = 64;

function clip(value, max = MAX_TEXT) {
  return value.length > max ? value.slice(0, max) : value;
}

// Both `checks` and `metrics` are built with Object.fromEntries rather than by
// assigning `obj[key] = ...`: the keys come from a remote document, and
// assigning a key literally named "__proto__" would set the object's prototype
// and silently drop that entry from the JSON sent to Dot.Memory.
function compactMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return {};

  const kept = [];
  for (const [key, value] of Object.entries(metrics)) {
    if (kept.length >= MAX_METRIC_KEYS) break;
    if (typeof value === 'number' && Number.isFinite(value)) {
      kept.push([clip(key, MAX_KEY), value]);
    } else if (typeof value === 'boolean') {
      kept.push([clip(key, MAX_KEY), value]);
    } else if (typeof value === 'string') {
      kept.push([clip(key, MAX_KEY), clip(value)]);
    }
  }
  return Object.fromEntries(kept);
}

/**
 * Builds the Dot.Memory `POST /api/intelligence/events` body for one platform
 * (design spec §3) -- the same envelope services/blupin-context uses and
 * Dot.Memory's LoopController already validates. `event_id` embeds the UTC
 * hour, so a duplicate or late run inside the same hour updates the existing
 * row instead of adding one.
 *
 * @param {{platform: string}} manifest
 * @param {object} result a fetchHealth() result
 * @param {Date} [now]
 */
export function buildObservation(manifest, result, now = new Date()) {
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const hour = iso.replace(/[-:T]/g, '').slice(0, 10);

  const entries = result.reachable ? Object.entries(result.checks) : [];
  const checks = Object.fromEntries(entries.slice(0, MAX_CHECKS).map(([key, check]) => [
    clip(key, MAX_KEY),
    {
      status: VALID_STATUSES.includes(check?.status) ? check.status : 'unknown',
      message: typeof check?.message === 'string' ? clip(check.message) : '',
      metrics: compactMetrics(check?.metrics),
    },
  ]));

  return {
    loop_id: `collect-${manifest.platform}-${day}`,
    event_id: `collect-${manifest.platform}-${hour}`,
    platform: 'dot-brain',
    source: 'platform-collector',
    subject_type: 'platform',
    subject_id: manifest.platform,
    subject_label: `${manifest.platform} hourly state`,
    occurred_at: iso,
    signature: result.reachable ? `status:${result.status}` : `failure:${result.kind}`,
    detail: {
      reachable: result.reachable,
      status: result.reachable ? result.status : null,
      kind: result.reachable ? null : result.kind,
      reason: result.reachable ? null : clip(result.reason),
      generated_at: result.reachable && typeof result.generated_at === 'string' ? clip(result.generated_at) : null,
      check_count: entries.length,
      checks,
    },
  };
}

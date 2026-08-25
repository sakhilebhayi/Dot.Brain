import {
  activeIncidentForCheck,
  insertIncident,
  newIncidentUid,
  setIncidentStatus,
  touchIncident,
} from './store.js';
import { normalizeChecks } from './health.js';

/** Checks whose critical failure means the platform itself is down (sev1). */
const INFRASTRUCTURE_CHECKS = ['availability', 'database'];

export function severityFor(checkKey, status) {
  if (status === 'critical') {
    return INFRASTRUCTURE_CHECKS.includes(checkKey) ? 'sev1' : 'sev2';
  }
  return 'sev3';
}

/**
 * Reconcile one health document against the incident store.
 *
 * Identity for dedupe is (platform, check_key): one active incident per
 * failing check, however many polls see it. warning->critical upgrades the
 * same incident's severity in place; healthy closes it; unknown neither
 * opens nor closes (no signal is not proof either way).
 *
 * Returns { opened, ongoing, resolved } of incident rows.
 */
export function reconcile(store, manifest, healthResult, now = new Date()) {
  const checks = normalizeChecks(healthResult);
  const opened = [];
  const ongoing = [];
  const resolved = [];

  for (const [checkKey, check] of Object.entries(checks)) {
    const active = activeIncidentForCheck(store, manifest.platform, checkKey);

    if (check.status === 'critical' || check.status === 'warning') {
      const severity = severityFor(checkKey, check.status);
      if (active) {
        const worse = severity < active.severity; // 'sev1' < 'sev2' lexicographically
        ongoing.push(touchIncident(store, active.incident_uid, {
          severity: worse ? severity : active.severity,
          detail: { check: checkKey, health: check },
        }, now));
      } else {
        opened.push(insertIncident(store, {
          incident_uid: newIncidentUid(manifest.platform, now),
          platform: manifest.platform,
          check_key: checkKey,
          signature: `${manifest.platform}:${checkKey}:${check.status}`,
          severity,
          detail: { check: checkKey, health: check },
        }, now));
      }
      continue;
    }

    if (check.status === 'healthy' && active) {
      resolved.push(setIncidentStatus(store, active.incident_uid, 'resolved', now));
    }
  }

  return { opened, ongoing, resolved };
}

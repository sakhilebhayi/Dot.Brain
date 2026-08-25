import { fetchHealth, normalizeChecks } from './health.js';

/**
 * Post-deploy verification: poll the platform's health endpoint N times
 * and require the remediated check to come back healthy without the
 * platform overall going critical. The first poll waits one interval so
 * the deploy has time to land.
 */
export async function postDeploy({
  manifest,
  checkKey,
  fetchImpl = fetch,
  env = process.env,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const polls = manifest.verification?.polls ?? 5;
  const intervalMs = (manifest.verification?.interval_s ?? 60) * 1000;
  const observations = [];

  for (let attempt = 1; attempt <= polls; attempt += 1) {
    await sleepImpl(intervalMs);
    const health = await fetchHealth(manifest, fetchImpl, env);
    const checks = normalizeChecks(health);
    const target = checks[checkKey] ?? { status: 'unknown' };
    observations.push({
      attempt,
      reachable: health.reachable,
      overall: health.reachable ? health.status : 'critical',
      target: target.status,
    });

    // Success as soon as the platform answers, the remediated check is
    // healthy, and nothing else has gone critical in the meantime.
    if (health.reachable && target.status === 'healthy' && health.status !== 'critical') {
      return { ok: true, observations };
    }
  }

  return { ok: false, observations };
}

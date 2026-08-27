/**
 * Cloudflare Worker: the guardian's clock.
 *
 * GitHub deprioritises high-frequency `schedule` triggers -- measured on
 * guardian-cron.yml: median 19m (2026-08-26) degrading to ~2.5h median
 * (2026-08-27) against a requested 5 minutes. `workflow_dispatch` is NOT
 * throttled that way, so this worker's cron calls it every 5 minutes and
 * the guardian itself stays in Actions (secrets, gh CLI, sqlite-on-cache
 * all unchanged). The workflow's `concurrency: guardian-poll` group makes
 * overlapping triggers queue rather than race the cached sqlite state.
 *
 * Runs OFF the cPanel host on purpose: a monitor that dies with its
 * subject reports "all clear" during the outage that matters.
 *
 * The workflow keeps its own `schedule` trigger as a fallback heartbeat
 * for the day this worker (or Cloudflare) dies.
 */

const DISPATCH_URL = 'https://api.github.com/repos/sakhilebhayi/Dot.Brain/actions/workflows/guardian-cron.yml/dispatches';

export async function dispatchGuardianPoll({ token, fetchImpl = fetch }) {
  if (!token) {
    throw new Error('GITHUB_TOKEN secret is not set; run: pbpaste | npx wrangler secret put GITHUB_TOKEN');
  }

  const response = await fetchImpl(DISPATCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'dot-guardian-trigger',
    },
    body: JSON.stringify({ ref: 'main' }),
  });

  // 204 is the only success shape workflow_dispatch has. Anything else
  // throws so the invocation records as errored in Cloudflare's metrics
  // instead of silently "succeeding" while the guardian goes unpolled.
  if (response.status !== 204) {
    const detail = await response.text();
    throw new Error(`workflow_dispatch failed: ${response.status} ${detail}`);
  }
}

export default {
  async scheduled(_event, env, _ctx, fetchImpl = fetch) {
    await dispatchGuardianPoll({ token: env.GITHUB_TOKEN, fetchImpl });
  },
};

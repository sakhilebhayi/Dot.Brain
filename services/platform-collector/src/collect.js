// services/platform-collector/src/collect.js
import { fetchHealth } from './fetch.js';
import { buildObservation } from './record.js';
import { writeObservation } from './memory.js';
import { describeError } from './errors.js';

/**
 * One collection run (design spec §4): fetch every platform concurrently,
 * record each result independently. A platform being down is data and keeps
 * the run green (alerting on it is Guardian's job); failing to RECORD turns
 * it red, because the point of this job is that Brain is never silently stale.
 * Each platform is isolated: an unexpected throw in one platform's work
 * becomes that platform's unrecorded row, never a lost hour for the others.
 *
 * @param {object} args
 * @param {object[]} args.manifests validated manifests (registry.js)
 * @param {{enabled: boolean, url?: string, token?: string}} args.cfg
 * @param {typeof fetch} [args.fetchImpl] used for both platforms and Dot.Memory
 * @param {Record<string, string|undefined>} [args.env]
 * @param {() => Date} [args.now]
 * @param {(ms: number) => Promise<void>} [args.sleep]
 * @param {boolean} [args.dryRun]
 */
export async function collect({ manifests, cfg, fetchImpl = fetch, env = process.env, now = () => new Date(), sleep, dryRun = false }) {
  const rows = await Promise.all(manifests.map(async (manifest) => {
    try {
      const result = await fetchHealth(manifest, { fetchImpl, env });
      const record = buildObservation(manifest, result, now());

      if (dryRun) {
        return { manifest, result, record, recorded: null };
      }

      const write = await writeObservation(cfg, record, { fetchImpl, sleep });
      return { manifest, result, record, recorded: write.ok, reason: write.ok ? null : write.reason };
    } catch (error) {
      // Displayed but never recorded. `crash` is deliberately not one of
      // FAILURE_KINDS: it is about this collector, not about the platform.
      const reason = `collector error: ${describeError(error)}`;
      return { manifest, result: { reachable: false, kind: 'crash', reason }, record: null, recorded: false, reason };
    }
  }));

  const unrecorded = rows.filter((row) => row.recorded === false).length;
  return { rows, exitCode: unrecorded > 0 ? 1 : 0 };
}

/** Markdown summary table, printed to stdout and to $GITHUB_STEP_SUMMARY. */
export function formatTable(rows) {
  const lines = ['| platform | reachable | status | kind | recorded |', '|---|---|---|---|---|'];
  for (const { manifest, result, recorded } of rows) {
    const recordedCell = recorded === null ? 'dry-run' : recorded ? 'yes' : 'NO';
    lines.push(
      `| ${manifest.platform} | ${result.reachable ? 'yes' : 'no'} | ${result.reachable ? result.status : '-'} | ${result.reachable ? '-' : result.kind} | ${recordedCell} |`,
    );
  }
  return lines.join('\n');
}

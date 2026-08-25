#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadManifests } from './registry.js';
import { openStore, listIncidents, listEscalations, breakerFor, resetBreaker } from './store.js';
import { runPoll } from './guardian.js';
import { memoryConfig, flush } from './memory-client.js';
import { writeReport, summarize } from './report.js';

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB = process.env.GUARDIAN_DB ?? join(HERE, '..', 'data', 'guardian.sqlite');
const DEFAULT_MANIFEST_DIR = process.env.GUARDIAN_MANIFESTS ?? join(HERE, '..', '..', '..', 'platforms', 'guardian');
const DEFAULT_REPORT = process.env.GUARDIAN_REPORT ?? join(HERE, '..', 'dashboard', 'index.html');

async function run(cmd, args, opts = {}) {
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...opts });
  return { stdout };
}

function usage() {
  console.log(`Usage: guardian <command>

Commands:
  poll [--platform <name>]   One detect/decide/act cycle for all (or one) platform(s)
  watch                      Poll forever, each platform on its own poll_interval_s
  status                     Platform health-at-a-glance from the local store
  incidents [--platform p]   List incidents in the local store
  escalations                List escalations / recommendations
  reset-breaker <platform>   Close an open circuit breaker (human acknowledgment)
  flush-memory               Retry queued Dot.Memory writes
  report                     Write the HTML dashboard (dashboard/index.html)

Environment:
  GUARDIAN_DB          sqlite path (default: services/guardian/data/guardian.sqlite)
  GUARDIAN_MANIFESTS   manifest dir (default: platforms/guardian)
  GUARDIAN_REPORT      dashboard output path
  DOT_MEMORY_URL       Dot.Memory base URL (optional; outbox queues without it)
  DOT_MEMORY_TOKEN     Dot.Memory service token
  <token_env>          per-manifest platform health token (e.g. DOT_MINES_GUARDIAN_TOKEN)`);
}

function loadContext(argv) {
  const store = openStore(resolve(DEFAULT_DB));
  let manifests = loadManifests(resolve(DEFAULT_MANIFEST_DIR));
  const platformFlag = argv.indexOf('--platform');
  if (platformFlag !== -1) {
    const platform = argv[platformFlag + 1];
    manifests = manifests.filter((manifest) => manifest.platform === platform);
    if (manifests.length === 0) {
      throw new Error(`No manifest for platform "${platform}" in ${DEFAULT_MANIFEST_DIR}`);
    }
  }
  return { store, manifests };
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);

  if (!command || command === 'help' || command === '--help') {
    usage();
    return 0;
  }

  if (command === 'poll') {
    const { store, manifests } = loadContext(argv);
    const summary = await runPoll({ store, manifests, run, log: console.error });
    console.log(JSON.stringify(summary, null, 2));
    const anyActive = summary.some((platform) => platform.opened + platform.ongoing > 0 || !platform.reachable);
    return anyActive ? 1 : 0;
  }

  if (command === 'watch') {
    const { store, manifests } = loadContext(argv);
    console.error(`guardian: watching ${manifests.length} platform(s)`);
    // Poll each platform on its own cadence; a failing cycle never kills the watcher.
    await Promise.all(manifests.map(async (manifest) => {
      for (;;) {
        try {
          await runPoll({ store, manifests: [manifest], run, log: console.error });
        } catch (error) {
          console.error(`guardian: poll failed for ${manifest.platform}: ${error.message}`);
        }
        await new Promise((resolveSleep) => setTimeout(resolveSleep, manifest.poll_interval_s * 1000));
      }
    }));
    return 0;
  }

  if (command === 'status') {
    const { store, manifests } = loadContext(argv);
    for (const manifest of manifests) {
      const active = listIncidents(store, { platform: manifest.platform, statuses: ['open', 'remediating'] });
      const breaker = breakerFor(store, manifest.platform);
      console.log(`${manifest.platform}: ${active.length} active incident(s), breaker ${breaker.state}`);
      for (const incident of active) {
        console.log(`  - ${incident.severity} ${incident.signature} (attempts ${incident.attempts}, since ${incident.first_seen})`);
      }
    }
    return 0;
  }

  if (command === 'incidents') {
    const { store } = loadContext(argv);
    console.log(JSON.stringify(listIncidents(store), null, 2));
    return 0;
  }

  if (command === 'escalations') {
    const { store } = loadContext(argv);
    console.log(JSON.stringify(listEscalations(store), null, 2));
    return 0;
  }

  if (command === 'reset-breaker') {
    const platform = argv[0];
    if (!platform) {
      throw new Error('Usage: guardian reset-breaker <platform>');
    }
    const { store } = loadContext([]);
    resetBreaker(store, platform);
    console.log(`Breaker closed for ${platform}.`);
    return 0;
  }

  if (command === 'flush-memory') {
    const { store } = loadContext(argv);
    const result = await flush(memoryConfig(), store);
    console.log(`Flushed ${result.flushed}; ${result.remaining} remaining.`);
    return result.remaining > 0 ? 1 : 0;
  }

  if (command === 'report') {
    const { store } = loadContext(argv);
    const summary = writeReport(store, resolve(DEFAULT_REPORT));
    console.log(`Dashboard written to ${DEFAULT_REPORT} (${summary.totals.incidents} incidents).`);
    return 0;
  }

  if (command === 'summary') {
    const { store } = loadContext(argv);
    console.log(JSON.stringify(summarize(store), null, 2));
    return 0;
  }

  usage();
  return 2;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`guardian: ${error.message}`);
    process.exit(2);
  },
);

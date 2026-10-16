#!/usr/bin/env node
// Usage: platform-collector collect --manifest-dir <dir> [--dry-run]
// Exit: 0 every observation recorded (platforms may be down -- that is data)
//       1 an observation could not be recorded, or Dot.Memory is not configured
//       2 usage error, invalid/missing manifests, or crash
import { appendFileSync } from 'node:fs';
import { loadManifests } from './registry.js';
import { memoryConfig } from './memory.js';
import { collect, formatTable } from './collect.js';

const [, , cmd, ...rest] = process.argv;
const USAGE = 'usage: platform-collector collect --manifest-dir <dir> [--dry-run]';

function flag(name) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? undefined : rest[i + 1];
}

const dir = flag('manifest-dir');
if (cmd !== 'collect' || !dir) {
  console.error(USAGE);
  process.exit(2);
}

const dryRun = rest.includes('--dry-run');

let manifests;
try {
  manifests = loadManifests(dir);
} catch (error) {
  console.error(`manifest error: ${error.message}`);
  process.exit(2);
}
if (manifests.length === 0) {
  console.error(`no manifests found in ${dir}`);
  process.exit(2);
}

const cfg = memoryConfig();
if (!dryRun && !cfg.enabled) {
  console.error('DOT_MEMORY_URL / DOT_MEMORY_TOKEN not set');
  process.exit(1);
}

let rows;
let exitCode;
let table;
try {
  ({ rows, exitCode } = await collect({ manifests, cfg, dryRun }));

  table = formatTable(rows);
  console.log(table);
  for (const row of rows) {
    if (!row.result.reachable) {
      console.log(`${row.manifest.platform}: ${row.result.kind} -- ${row.result.reason}`);
    }
    if (row.recorded === false) {
      console.error(`${row.manifest.platform}: not recorded -- ${row.reason}`);
    }
  }
} catch (error) {
  console.error(`crash: ${error?.stack ?? error}`);
  process.exit(2);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Platform collection\n\n${table}\n`);
  } catch (error) {
    console.error(`warning: could not write job summary: ${error.message}`);
  }
}

process.exit(exitCode);

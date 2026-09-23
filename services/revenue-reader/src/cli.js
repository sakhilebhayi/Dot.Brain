#!/usr/bin/env node
// Usage: revenue-reader poll --manifest-dir platforms/revenue-reader [--platform dot-billing]
import { loadManifests } from './registry.js';
import { pollPlatform } from './client.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

if (cmd === 'poll') {
  const dir = flag('manifest-dir');
  const onlyPlatform = flag('platform');
  if (!dir) {
    console.error('usage: revenue-reader poll --manifest-dir <dir> [--platform <id>]');
    process.exit(1);
  }

  const manifests = loadManifests(dir).filter((m) => !onlyPlatform || m.platform === onlyPlatform);
  let exitCode = 0;

  for (const manifest of manifests) {
    const result = await pollPlatform(manifest);
    if (result.ok) {
      console.log(`${result.platform}: ${result.signals.length} signal(s), classification=${result.classification}`);
    } else {
      console.error(`${result.platform}: ${result.kind} -- ${result.reason}`);
      exitCode = 1;
    }
  }

  process.exit(exitCode);
} else {
  console.error('usage: revenue-reader poll --manifest-dir <dir> [--platform <id>]');
  process.exit(1);
}

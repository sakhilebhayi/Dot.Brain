#!/usr/bin/env node
// Usage:
//   insight-delivery classify < conclusion.json
//   insight-delivery record < insight.json                 (runs gates, then records if cleared)
//   insight-delivery search --domain onboarding [--scope global] [--platform dot-hr]
//   insight-delivery deliver --id ins-1 --target dot-hr [--scope global]
import { classifyConclusion } from './classify.js';
import { runEthicsGate, runSecurityGate } from './gates.js';
import { memoryConfig, recordInsight, searchInsights } from './memory-client.js';
import { deliverInsight } from './deliver.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const cfg = memoryConfig();

if (cmd === 'classify') {
  const conclusion = await readStdin();
  console.log(classifyConclusion(conclusion));
} else if (cmd === 'record') {
  const insight = await readStdin();
  const ethics = runEthicsGate(insight);
  if (!ethics.passed) {
    console.error(`ethics gate rejected: ${ethics.reason}`);
    process.exit(1);
  }
  // In this reference implementation the payload self-declares its own
  // clearance -- not a real authorization check. A real deployment would
  // source clearance from the platform manifest, not from the payload
  // being gated.
  const security = runSecurityGate(insight, insight.targetPlatformClearance ?? ['public']);
  if (!security.passed) {
    console.error(`security gate rejected: ${security.reason}`);
    process.exit(1);
  }
  // insight.schema.json has additionalProperties: false and does not
  // declare targetMetric/targetPlatformClearance -- they're gating-only
  // fields, so strip them before the payload is recorded.
  const { targetMetric, targetPlatformClearance, ...insightToRecord } = insight;
  const result = await recordInsight(cfg, insightToRecord);
  if (!result.ok) {
    console.error(`record failed: ${result.reason}`);
    process.exit(1);
  }
  console.log('recorded');
} else if (cmd === 'search') {
  const result = await searchInsights(cfg, { domain: flag('domain'), scope: flag('scope'), platform: flag('platform') });
  console.log(JSON.stringify(result, null, 2));
} else if (cmd === 'deliver') {
  const insightId = flag('id');
  const targetPlatform = flag('target');
  const scope = flag('scope');
  if (!insightId || !targetPlatform) {
    console.error('usage: insight-delivery deliver --id <insight-id> --target <platform> [--scope <scope>]');
    process.exit(1);
  }
  console.error('deliver: no notifyClient wired in this CLI build -- integrate a real Dot.Notify client before use.');
  process.exit(1);
} else {
  console.error('usage: insight-delivery <classify|record|search|deliver>');
  process.exit(1);
}

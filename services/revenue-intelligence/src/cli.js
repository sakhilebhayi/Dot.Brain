#!/usr/bin/env node
// Usage: revenue-intelligence detect --signals-file <path.json>
// <path.json> must contain a Revenue Reader poll success result:
// {platform, generated_at, classification, signals}
import { readFileSync } from 'node:fs';
import { detectOpportunities } from './opportunities.js';

const [, , cmd, ...rest] = process.argv;

function flag(name, fallback) {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? fallback : rest[i + 1];
}

if (cmd === 'detect') {
  const file = flag('signals-file');
  if (!file) {
    console.error('usage: revenue-intelligence detect --signals-file <path.json>');
    process.exit(1);
  }

  const pollResult = JSON.parse(readFileSync(file, 'utf8'));
  const insights = detectOpportunities(pollResult);
  console.log(JSON.stringify(insights, null, 2));
} else {
  console.error('usage: revenue-intelligence detect --signals-file <path.json>');
  process.exit(1);
}

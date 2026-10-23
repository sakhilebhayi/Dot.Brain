#!/usr/bin/env node
// Usage: infodot-knowledge run [--dry-run | --apply] [--since <ISO8601>] [--limit <1-100>] [--summary-file <path>]
// Default is a DRY RUN: it reads, scores and prints counts, and writes nothing.
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2));

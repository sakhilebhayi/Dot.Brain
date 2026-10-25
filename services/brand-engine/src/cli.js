#!/usr/bin/env node
// Usage: brand-engine profile list|show|validate|resolve ... | framework list|show ... | drift <profile> --root <dir>
//        | score | compare | rubric | analyze | plan | verify | evidence assemble | propose | lint-proposal (see the README)
// It loads, validates, analyses and reports. It writes only the files named by --out / -o, and never calls a network.
import { main } from './main.js';

process.exitCode = await main(process.argv.slice(2));

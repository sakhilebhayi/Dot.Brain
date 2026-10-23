#!/usr/bin/env node
// Usage: brand-engine profile list|show|validate|resolve ... | framework list|show ... | drift <profile> --root <dir>
// Read-only: it loads, validates and reports. It never writes a file and never calls a network.
import { main } from './main.js';

process.exitCode = main(process.argv.slice(2));

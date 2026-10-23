// services/brand-engine/src/analyze/adapters/index.js
//
// Reads a directory of reports that OTHER tools produced and turns them into
// evidence. The engine never runs those tools; the Action or the Claude Skill
// does, and drops the files here. Nothing in this directory is executed.
//
// How a file is routed (by name first, so an empty-but-valid report is not
// mistaken for nothing; then by content for unnamed files):
//   *detect*.json, *impeccable*.json   design detector     (detector.js)
//   *axe*.json                         axe-core            (axe.js)
//   *lighthouse*.json, *lhr*.json      Lighthouse          (lighthouse.js)
//   *junit*.xml, *xunit*.xml, *.tap   test results        (tests.js); any other
//                                      .xml is taken only if it is a <testsuite>
//   *.json carrying a manual format    assessments/observed: NOT read here;
//                                      they go to `evidence assemble`
//   anything else                      skipped, and listed with the reason
// A file that is routed to an adapter and is not what it claims to be is an
// ERROR (fail closed); a file that cannot be routed is only listed.
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_LIMITS } from '../limits.js';
import { byText } from '../text.js';
import { sha256Hex } from '../../score/util.js';
import * as axe from './axe.js';
import { AdapterError } from './common.js';
import * as detector from './detector.js';
import * as lighthouse from './lighthouse.js';
import { manualFormat } from './manual.js';
import * as tests from './tests.js';

export const ADAPTERS = Object.freeze([detector, axe, lighthouse, tests]);
export const adapterByName = (name) => ADAPTERS.find((a) => a.NAME === name);

/** The adapters able to produce a rubric check id (for the "no report supplied" reason). */
export const adaptersFor = (checkId) => ADAPTERS.filter((a) => a.PRODUCES.includes(checkId)).map((a) => a.NAME);

function route(name, text) {
  for (const a of ADAPTERS) if (a.matchesName(name)) return { adapter: a, how: 'name' };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let value;
    try { value = JSON.parse(text); } catch { return { adapter: null, reason: 'looks like JSON but is not valid JSON' }; }
    if (manualFormat(value)) return { adapter: null, reason: 'a manual assessment or observed file: pass it to `evidence assemble`, not to analyze' };
    for (const a of [axe, lighthouse, detector]) if (a.sniff(value)) return { adapter: a, how: 'content' };
    return { adapter: null, reason: 'JSON of a kind no adapter recognises' };
  }
  if (tests.sniff(text)) return { adapter: tests, how: 'content' };
  return { adapter: null, reason: 'not a recognised report type' };
}

/**
 * ingestReports(dir, {root, sink}) -> { evidence, findings, notes, ingested, skipped, superseded }
 * Throws AdapterError (or a plain Error with a clear message) on anything unreadable or malformed.
 */
export function ingestReports(dir, { root, sink }) {
  let real;
  try {
    real = realpathSync(dir);
    if (!lstatSync(real).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new AdapterError('reports', dir, 'directory cannot be read');
  }
  const names = readdirSync(real).filter((n) => !n.startsWith('.')).sort(byText);
  if (names.length > REPORT_LIMITS.maxFiles) throw new AdapterError('reports', dir, `directory has more than ${REPORT_LIMITS.maxFiles} files`);
  const skipped = [];
  const loaded = [];
  let total = 0;
  for (const name of names) {
    const path = join(real, name);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) { skipped.push({ file: name, reason: 'a symlink is not read' }); continue; }
    if (!st.isFile()) { skipped.push({ file: name, reason: 'not a regular file' }); continue; }
    if (st.size > REPORT_LIMITS.maxFileBytes) throw new AdapterError('reports', name, `is larger than ${REPORT_LIMITS.maxFileBytes} bytes`);
    total += st.size;
    if (total > REPORT_LIMITS.maxTotalBytes) throw new AdapterError('reports', name, `pushes the directory over ${REPORT_LIMITS.maxTotalBytes} bytes`);
    const buf = readFileSync(path);
    if (buf.subarray(0, 8000).includes(0)) { skipped.push({ file: name, reason: 'binary file' }); continue; }
    const text = buf.toString('utf8');
    const routed = route(name, text);
    if (!routed.adapter) { skipped.push({ file: name, reason: routed.reason }); continue; }
    loaded.push({ name, text, sha256: sha256Hex(buf), bytes: st.size, adapter: routed.adapter });
  }

  const evidence = [];
  const findings = [];
  const notes = [];
  const ingested = loaded.map((l) => ({ file: l.name, adapter: l.adapter.NAME, sha256: l.sha256, bytes: l.bytes }));
  for (const a of ADAPTERS) {
    const mine = loaded.filter((l) => l.adapter === a);
    if (mine.length === 0) continue;
    const out = a.ingest(mine, { root, sink });
    evidence.push(...out.evidence.map((e) => ({ ...e, priority: a.PRIORITY })));
    findings.push(...out.findings);
    notes.push(...out.notes);
  }

  // One check id, one source: the highest-priority adapter wins; the others are recorded.
  const byCheck = new Map();
  for (const e of evidence) {
    if (!byCheck.has(e.check_id)) byCheck.set(e.check_id, []);
    byCheck.get(e.check_id).push(e);
  }
  const keep = [];
  const superseded = [];
  const droppedOrigins = new Map(); // check_id -> origin that lost
  for (const [checkId, list] of [...byCheck].sort(([a], [b]) => byText(a, b))) {
    list.sort((a, b) => b.priority - a.priority || byText(a.origin, b.origin));
    keep.push(list[0]);
    for (const loser of list.slice(1)) {
      superseded.push({ check_id: checkId, origin: loser.origin, superseded_by: list[0].origin });
      if (loser.origin !== list[0].origin) droppedOrigins.set(`${checkId}|${loser.origin}`, true);
    }
  }
  const keptFindings = findings.filter((f) => !droppedOrigins.has(`${f.check_id}|${f.origin}`));
  return {
    evidence: keep.map(({ priority, ...e }) => e),
    findings: keptFindings,
    notes: [...new Set(notes)].sort(byText),
    ingested,
    skipped,
    superseded,
  };
}

// services/brand-engine/src/analyze/docs.js
//
// Reading the engine's own documents back (analysis.json, plan.json) and the
// files a person supplies. Every read is size-bounded, parsed strictly,
// checked against the schema FILE, and (for engine documents) against its
// integrity hash, so a hand-edited baseline cannot be used to fake a result.
import { lstatSync, readFileSync } from 'node:fs';
import { DOC_MAX_BYTES } from './limits.js';
import { scoreSchema } from '../score/schemas.js';
import { integrityProblems } from './analyze.js';

export class DocError extends Error {
  constructor(message, { refused = false } = {}) {
    super(message);
    this.name = 'DocError';
    this.refused = refused;
  }
}

/** Read a bounded regular file as UTF-8 text. */
export function readBounded(path, what, max = DOC_MAX_BYTES) {
  let st;
  try { st = lstatSync(path); } catch (error) { throw new DocError(`${what} ${path}: cannot read (${error.code ?? 'error'})`); }
  if (st.isSymbolicLink()) throw new DocError(`${what} ${path}: a symlink is not read`);
  if (!st.isFile()) throw new DocError(`${what} ${path}: not a regular file`);
  if (st.size > max) throw new DocError(`${what} ${path}: larger than ${max} bytes`);
  return readFileSync(path, 'utf8');
}

/**
 * Load an engine document: bounded, valid JSON, valid against schemas/<schema>.schema.json,
 * and unmodified. A document that fails its integrity hash is REFUSED (exit 3), not just invalid.
 */
export function readEngineDocument(path, schema, what) {
  const text = readBounded(path, what);
  let doc;
  try { doc = JSON.parse(text); } catch (error) { throw new DocError(`${what} ${path}: invalid JSON (${String(error.message).slice(0, 100)})`); }
  const problems = scoreSchema(schema).validate(doc);
  if (problems.length) throw new DocError(`${what} ${path} is not a valid ${schema}:\n${problems.slice(0, 10).join('\n')}`);
  if (schema === 'brand-analysis') {
    if (doc.input.commit !== null && !/^[0-9a-f]{40}$/.test(doc.input.commit)) throw new DocError(`${what} ${path}: input.commit must be null or 40 hex characters`);
    if (doc.input.repo !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(doc.input.repo)) throw new DocError(`${what} ${path}: input.repo must be null or owner/name`);
  }
  const bad = integrityProblems(doc);
  if (bad.length) throw new DocError(`${what} ${path}: ${bad[0]}`, { refused: true });
  return doc;
}

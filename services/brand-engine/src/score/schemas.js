// services/brand-engine/src/score/schemas.js
import { fileURLToPath } from 'node:url';
import { readJson } from '../json.js';
import { compileSchema } from '../schema.js';

const SCHEMAS_DIR = new URL('../../../../schemas/', import.meta.url);
const cache = new Map();

/** Compile one of the scoring schemas from the schema FILE (no hand-copied second definition). */
export function scoreSchema(name) {
  if (!cache.has(name)) {
    const read = readJson(fileURLToPath(new URL(`${name}.schema.json`, SCHEMAS_DIR)));
    if (!read.ok) throw new Error(`cannot load schema ${name}: ${read.error}`);
    cache.set(name, { validate: compileSchema(read.value), schema: read.value });
  }
  return cache.get(name);
}

export const validateRubricShape = (doc) => scoreSchema('brand-rubric').validate(doc);
export const validateEvidenceShape = (doc) => scoreSchema('brand-evidence').validate(doc);
export const validateReportShape = (doc) => scoreSchema('brand-score').validate(doc);

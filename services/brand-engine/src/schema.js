// services/brand-engine/src/schema.js
//
// A deliberately small JSON Schema interpreter. The repository has no schema
// validator dependency and every service is zero-dependency, so the two
// schemas this service owns (schemas/brand-profile.schema.json,
// schemas/brand-principle.schema.json) are enforced by interpreting the schema
// FILES themselves, not by a hand-copied second definition that could drift
// from them. Cross-field rules the schema cannot express live in rules.js.
//
// Fail closed on the schema side: a keyword this interpreter does not
// implement throws when the schema is compiled, so a schema edit can never
// quietly stop being enforced.

const KEYWORDS = new Set([
  '$schema', '$id', '$defs', '$ref', 'title', 'description', 'default',
  'type', 'enum', 'const', 'pattern', 'minLength', 'maxLength', 'minimum', 'maximum',
  'minItems', 'maxItems', 'uniqueItems', 'items', 'properties', 'required',
  'additionalProperties', 'patternProperties', 'format',
]);

const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const FORMATS = {
  'date-time': (s) => DATE_TIME.test(s) && !Number.isNaN(Date.parse(s)),
};

function assertSupported(schema, where) {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`schema ${where}: must be an object`);
  }
  for (const key of Object.keys(schema)) {
    if (!KEYWORDS.has(key)) throw new Error(`schema ${where}: unsupported keyword "${key}"`);
  }
  if (schema.format !== undefined && !FORMATS[schema.format]) {
    throw new Error(`schema ${where}: unsupported format "${schema.format}"`);
  }
  for (const [name, sub] of Object.entries(schema.$defs ?? {})) assertSupported(sub, `${where}/$defs/${name}`);
  for (const [name, sub] of Object.entries(schema.properties ?? {})) assertSupported(sub, `${where}/properties/${name}`);
  for (const [name, sub] of Object.entries(schema.patternProperties ?? {})) assertSupported(sub, `${where}/patternProperties/${name}`);
  if (schema.items !== undefined) assertSupported(schema.items, `${where}/items`);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object') {
    assertSupported(schema.additionalProperties, `${where}/additionalProperties`);
  }
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isType(type, value) {
  switch (type) {
    case 'string': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'integer': return Number.isInteger(value);
    case 'array': return Array.isArray(value);
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'null': return value === null;
    default: throw new Error(`unsupported type "${type}"`);
  }
}

function walk(root, schema, value, path, errors) {
  if (schema.$ref !== undefined) {
    const m = /^#\/\$defs\/([A-Za-z0-9_]+)$/.exec(schema.$ref);
    const target = m && root.$defs?.[m[1]];
    if (!target) throw new Error(`unresolvable $ref ${schema.$ref}`);
    walk(root, target, value, path, errors);
    return;
  }

  if (schema.type !== undefined && !isType(schema.type, value)) {
    errors.push(`${path}: must be ${schema.type}, got ${typeOf(value)}`);
    return; // nothing below is meaningful on the wrong type
  }
  if (schema.enum !== undefined && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: must be ${JSON.stringify(schema.const)}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: must not be shorter than ${schema.minLength} characters`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: must not be longer than ${schema.maxLength} characters`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match pattern ${schema.pattern}`);
    if (schema.format !== undefined && !FORMATS[schema.format](value)) errors.push(`${path}: is not a valid ${schema.format}`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: must have at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: must have at most ${schema.maxItems} item(s)`);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) { errors.push(`${path}: items must be unique`); break; }
        seen.add(key);
      }
    }
    if (schema.items !== undefined) value.forEach((item, i) => walk(root, schema.items, item, `${path}[${i}]`, errors));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key}: is required`);
    }
    const props = schema.properties ?? {};
    const patterns = Object.entries(schema.patternProperties ?? {}).map(([p, s]) => [new RegExp(p), s]);
    for (const key of Object.keys(value)) {
      const here = `${path}.${key}`;
      if (Object.hasOwn(props, key)) {
        walk(root, props[key], value[key], here, errors);
        continue;
      }
      const matched = patterns.filter(([re]) => re.test(key));
      if (matched.length) {
        for (const [, sub] of matched) walk(root, sub, value[key], here, errors);
        continue;
      }
      if (schema.additionalProperties === false) errors.push(`${here}: is not an allowed property`);
      else if (typeof schema.additionalProperties === 'object') walk(root, schema.additionalProperties, value[key], here, errors);
    }
  }
}

/** Compile a schema (throws on any keyword this interpreter does not enforce). Returns validate(value) -> string[] */
export function compileSchema(schema) {
  assertSupported(schema, '#');
  return (value) => {
    const errors = [];
    walk(schema, schema, value, '$', errors);
    return errors;
  };
}

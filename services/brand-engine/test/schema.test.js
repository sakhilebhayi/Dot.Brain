import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSchema } from '../src/schema.js';
import { EVIDENCE_CLASSES, STATUSES } from '../src/rules.js';
import { ROOT, readJsonFile } from './_helpers.js';

const profileSchema = readJsonFile(`${ROOT}schemas/brand-profile.schema.json`);
const principleSchema = readJsonFile(`${ROOT}schemas/brand-principle.schema.json`);

test('both shipped schemas compile: every keyword they use is enforced by the interpreter', () => {
  assert.doesNotThrow(() => compileSchema(profileSchema));
  assert.doesNotThrow(() => compileSchema(principleSchema));
});

test('a keyword the interpreter does not implement fails closed at compile time', () => {
  for (const keyword of ['oneOf', 'anyOf', 'allOf', 'if', 'not', 'dependentRequired', 'contains']) {
    assert.throws(() => compileSchema({ type: 'object', [keyword]: [] }), /unsupported keyword/, keyword);
  }
  assert.throws(() => compileSchema({ type: 'string', format: 'email' }), /unsupported format/);
  assert.throws(() => compileSchema({ properties: { a: { oneOf: [] } } }), /unsupported keyword "oneOf"/);
});

test('an unresolvable $ref throws instead of passing', () => {
  const v = compileSchema({ type: 'object', properties: { a: { $ref: '#/$defs/nope' } } });
  assert.throws(() => v({ a: 1 }), /unresolvable/);
});

const accept = [
  ['string', { type: 'string' }, 'x'],
  ['integer', { type: 'integer', minimum: 1 }, 3],
  ['enum', { enum: ['a', 'b'] }, 'b'],
  ['const', { const: false }, false],
  ['pattern', { type: 'string', pattern: '^BXP-[0-9]{2}$' }, 'BXP-07'],
  ['date-time', { type: 'string', format: 'date-time' }, '2026-10-23T00:00:00Z'],
  ['array bounds', { type: 'array', minItems: 1, items: { type: 'string' } }, ['x']],
  ['x- extension', { type: 'object', additionalProperties: false, patternProperties: { '^x-': {} } }, { 'x-note': 1 }],
];
const reject = [
  ['wrong type', { type: 'string' }, 3, /must be string/],
  ['float as integer', { type: 'integer' }, 1.5, /must be integer/],
  ['NaN as number', { type: 'number' }, Number.NaN, /must be number/],
  ['below minimum', { type: 'number', minimum: 0 }, -0.1, />= 0/],
  ['above maximum', { type: 'number', maximum: 1 }, 1.1, /<= 1/],
  ['enum miss', { enum: ['a'] }, 'c', /one of/],
  ['const miss', { const: false }, true, /must be false/],
  ['pattern miss', { type: 'string', pattern: '^a$' }, 'b', /pattern/],
  ['empty string', { type: 'string', minLength: 1 }, '', /shorter/],
  ['bad date-time', { type: 'string', format: 'date-time' }, '2026-13-45T00:00:00Z', /valid date-time/],
  ['date without time', { type: 'string', format: 'date-time' }, '2026-10-23', /valid date-time/],
  ['too few items', { type: 'array', minItems: 2 }, [1], /at least 2/],
  ['duplicates', { type: 'array', uniqueItems: true }, ['a', 'a'], /unique/],
  ['missing required', { type: 'object', required: ['a'] }, {}, /\.a: is required/],
  ['extra property', { type: 'object', additionalProperties: false, properties: { a: {} } }, { b: 1 }, /not an allowed property/],
  ['__proto__ own key', { type: 'object', additionalProperties: false, properties: {} }, JSON.parse('{"__proto__": {"x": 1}}'), /not an allowed property/],
];

for (const [name, schema, value] of accept) {
  test(`accepts: ${name}`, () => assert.deepEqual(compileSchema(schema)(value), []));
}
for (const [name, schema, value, re] of reject) {
  test(`rejects: ${name}`, () => {
    const errors = compileSchema(schema)(value);
    assert.ok(errors.length > 0, 'expected an error');
    assert.match(errors.join('\n'), re);
  });
}

test('errors name the path of the offending value', () => {
  const v = compileSchema(profileSchema);
  const errors = v({ id: 'Bad Id' });
  assert.ok(errors.some((e) => e.startsWith('$.id:')));
  assert.ok(errors.some((e) => e.startsWith('$.purpose: is required') || e.includes('.purpose: is required')));
});

test('the enums in rules.js are the schemas\' enums, so code and schema cannot drift', () => {
  for (const schema of [profileSchema, principleSchema]) {
    assert.deepEqual(schema.properties.status.enum, STATUSES);
    assert.deepEqual(schema.$defs.evidenceItem.properties.class.enum, EVIDENCE_CLASSES);
  }
});

test('the evidence, provenance and contributor definitions are identical in both schemas', () => {
  for (const def of ['evidenceItem', 'provenance', 'contributor', 'approver', 'semver', 'confidence']) {
    assert.deepEqual(profileSchema.$defs[def], principleSchema.$defs[def], def);
  }
});

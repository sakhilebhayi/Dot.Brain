import test from 'node:test';
import assert from 'node:assert/strict';
import { checkEvidenceItem, checkPrinciple, checkProfile, checkRelativePath, checkStatus, checkTransition, confidenceCap } from '../src/rules.js';
import { validatePrincipleDoc, validateProfileDoc } from '../src/registry.js';
import { clone, profileDoc, readJsonFile, BRAND } from './_helpers.js';

const AI = { id: 'claude-sonnet-5-5', kind: 'ai', display_name: 'Claude Sonnet 5.5' };
const OWNER = { id: 'the-owner', kind: 'human', display_name: 'The Owner' };

test('evidence classes: required and forbidden fields, as a table', () => {
  const ok = [
    { class: 'documented_research', summary: 's', citation: 'A real source', citation_verified: false },
    { class: 'documented_research', summary: 's', citation: 'A real source', citation_verified: true },
    { class: 'observed_behaviour', summary: 's', n: 12, method: 'moderated test' },
    { class: 'internal_hypothesis', summary: 's', rationale: 'because' },
    { class: 'validated_finding', summary: 's', experiment_ref: 'EXP-1' },
    { class: 'declared_intent', summary: 's', declared_by: 'owner' },
  ];
  for (const item of ok) assert.deepEqual(checkEvidenceItem(item, '$'), [], item.class);

  const bad = [
    [{ class: 'documented_research', summary: 's', citation: 'x' }, /requires citation_verified/],
    [{ class: 'documented_research', summary: 's', citation_verified: false }, /requires citation/],
    [{ class: 'observed_behaviour', summary: 's', n: 3 }, /requires method/],
    [{ class: 'observed_behaviour', summary: 's', method: 'm' }, /requires n/],
    [{ class: 'internal_hypothesis', summary: 's' }, /requires rationale/],
    [{ class: 'validated_finding', summary: 's' }, /requires experiment_ref/],
    [{ class: 'declared_intent', summary: 's' }, /requires declared_by/],
    // dressing a weak class as a stronger one
    [{ class: 'declared_intent', summary: 's', declared_by: 'o', citation: 'x', citation_verified: true }, /citation is not allowed on evidence class declared_intent/],
    [{ class: 'declared_intent', summary: 's', declared_by: 'o', n: 100, method: 'm' }, /n is not allowed/],
    [{ class: 'internal_hypothesis', summary: 's', rationale: 'r', experiment_ref: 'EXP-1' }, /experiment_ref is not allowed on evidence class internal_hypothesis/],
    [{ class: 'documented_research', summary: 's', citation: 'x', citation_verified: false, experiment_ref: 'EXP-1' }, /experiment_ref is not allowed/],
  ];
  for (const [item, re] of bad) assert.match(checkEvidenceItem(item, '$').join('\n'), re, JSON.stringify(item));
});

test('the schema rejects an unknown evidence class', () => {
  const doc = readJsonFile(`${BRAND}framework/principles/BXP-01-emotional-positioning.json`);
  doc.evidence[0].class = 'vibes';
  assert.match(validatePrincipleDoc(doc).join('\n'), /evidence\[0\]\.class/);
});

test('a principle with validated_finding but no experiment reference is rejected; documented_research without citation is rejected', () => {
  const doc = readJsonFile(`${BRAND}framework/principles/BXP-01-emotional-positioning.json`);
  doc.evidence = [{ class: 'validated_finding', summary: 'users liked it' }];
  assert.match(validatePrincipleDoc(doc).join('\n'), /validated_finding requires experiment_ref/);
  doc.evidence = [{ class: 'documented_research', summary: 'a study says' }];
  assert.match(validatePrincipleDoc(doc).join('\n'), /requires citation/);
});

test('confidence cannot exceed what the evidence classes support', () => {
  const hyp = [{ class: 'internal_hypothesis', summary: 's', rationale: 'r' }];
  const intent = [{ class: 'declared_intent', summary: 's', declared_by: 'o' }];
  const unverified = [{ class: 'documented_research', summary: 's', citation: 'c', citation_verified: false }];
  const verified = [{ class: 'documented_research', summary: 's', citation: 'c', citation_verified: true }];
  const observed = [{ class: 'observed_behaviour', summary: 's', n: 30, method: 'm' }];
  const validated = [{ class: 'validated_finding', summary: 's', experiment_ref: 'EXP-1' }];
  assert.equal(confidenceCap(hyp, { subject: 'principle' }), 0.5);
  assert.equal(confidenceCap(intent, { subject: 'principle' }), 0.5, 'intent is not evidence of an effect');
  assert.equal(confidenceCap(intent, { subject: 'profile' }), 0.9, 'but it is evidence of what the owner intends');
  assert.equal(confidenceCap(unverified, { subject: 'principle' }), 0.6);
  assert.equal(confidenceCap(verified, { subject: 'principle' }), 0.8);
  assert.equal(confidenceCap(observed, { subject: 'principle' }), 0.85);
  assert.equal(confidenceCap(validated, { subject: 'principle' }), 1);

  const doc = readJsonFile(`${BRAND}framework/principles/BXP-01-emotional-positioning.json`);
  doc.confidence = 0.9;
  assert.match(validatePrincipleDoc(doc).join('\n'), /exceeds 0\.5/);
});

test('status rules: ratified needs an approver and ratified_at; draft and proposed must not claim either', () => {
  const base = { contributors: [AI] };
  assert.match(checkStatus({ ...base, status: 'ratified' }).join('\n'), /requires an approver/);
  assert.match(checkStatus({ ...base, status: 'ratified', approver: { id: 'o', kind: 'human' } }).join('\n'), /requires ratified_at/);
  assert.match(checkStatus({ ...base, status: 'ratified', ratified_at: '2026-10-23T00:00:00Z' }).join('\n'), /requires an approver/);
  assert.deepEqual(checkStatus({ contributors: [AI, OWNER], status: 'ratified', approver: { id: 'the-owner', kind: 'human' }, ratified_at: '2026-10-23T00:00:00Z' }), []);
  for (const status of ['draft', 'proposed']) {
    assert.match(checkStatus({ ...base, status, approver: { id: 'o', kind: 'human' } }).join('\n'), /must not name an approver/);
    assert.match(checkStatus({ ...base, status, ratified_at: '2026-10-23T00:00:00Z' }).join('\n'), /must not carry ratified_at/);
  }
});

test('an AI contributor cannot be the approver, and the schema forbids a non-human approver kind', () => {
  const doc = profileDoc('dot-ecosystem');
  doc.status = 'ratified';
  doc.ratified_at = '2026-10-23T00:00:00Z';
  doc.approver = { id: AI.id, kind: 'human' };
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /AI contributor; an AI session may propose but never ratify/);
  doc.approver = { id: AI.id, kind: 'ai' };
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /approver\.kind: must be "human"/);
});

test('a ratified profile with a human approver who is not an AI contributor validates (the mechanism works; shipped data does not use it)', () => {
  const doc = profileDoc('dot-ecosystem');
  doc.status = 'ratified';
  doc.ratified_at = '2026-10-23T00:00:00Z';
  doc.approver = { id: 'the-owner', kind: 'human' };
  assert.deepEqual(validateProfileDoc(doc, { location: 'brain' }), []);
});

test('status transitions: only a human may ratify, and ratification cannot skip proposed', () => {
  const human = { id: 'the-owner', kind: 'human' };
  const ai = { id: AI.id, kind: 'ai' };
  assert.equal(checkTransition('draft', 'proposed', ai).ok, true, 'an AI session may propose');
  assert.equal(checkTransition('proposed', 'draft', ai).ok, true);
  const aiRatify = checkTransition('proposed', 'ratified', ai);
  assert.equal(aiRatify.ok, false);
  assert.match(aiRatify.reason, /only a human approver can ratify/);
  assert.equal(checkTransition('proposed', 'ratified', human).ok, true);
  assert.equal(checkTransition('draft', 'ratified', human).ok, false, 'must pass through proposed');
  assert.equal(checkTransition('ratified', 'draft', human).ok, false);
  assert.equal(checkTransition('ratified', 'superseded', human).ok, true);
  assert.equal(checkTransition('superseded', 'draft', human).ok, false);
  assert.equal(checkTransition('proposed', 'ratified', undefined).ok, false);
  assert.equal(checkTransition('proposed', 'ratified', { id: '', kind: 'human' }).ok, false);
  assert.equal(checkTransition('proposed', 'ratified', { id: 'x', kind: 'robot' }).ok, false);
  assert.equal(checkTransition('draft', 'nonsense', human).ok, false);
});

test('unknowns are required, and non-empty for a draft or proposed profile', () => {
  const doc = profileDoc('infodot');
  delete doc.unknowns;
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /unknowns: is required/);
  const empty = profileDoc('infodot');
  empty.unknowns = [];
  assert.match(validateProfileDoc(empty, { location: 'brain' }).join('\n'), /must record what it does not know/);
  empty.status = 'proposed';
  assert.match(validateProfileDoc(empty, { location: 'brain' }).join('\n'), /must record what it does not know/);
});

test('emotional promise must be labelled intended and unmeasured', () => {
  const doc = profileDoc('infodot');
  doc.emotional_promise[0].measured = true;
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /emotional_promise\[0\]\.measured: must be false/);
  const doc2 = profileDoc('infodot');
  doc2.emotional_promise[0].label = 'measured';
  assert.match(validateProfileDoc(doc2, { location: 'brain' }).join('\n'), /label: must be "intended"/);
});

test('an identified audience needs evidence; an unidentified one may not smuggle in stronger evidence', () => {
  const doc = profileDoc('infodot');
  doc.audience[0].evidence = [];
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /identified audience segment requires evidence/);
  const b = profileDoc('blupin');
  b.audience[0].evidence = [{ class: 'observed_behaviour', summary: 's', n: 5, method: 'm' }];
  assert.match(validateProfileDoc(b, { location: 'brain' }).join('\n'), /unidentified audience segment cannot carry/);
});

test('Dot.Brain is public: private kinds and non-public classifications cannot be stored here', () => {
  const classified = profileDoc('infodot');
  classified.classification = 'restricted';
  assert.match(validateProfileDoc(classified, { location: 'brain' }).join('\n'), /only classification "public"/);
  assert.deepEqual(validateProfileDoc(classified, { location: 'product' }).filter((e) => /classification/.test(e)), [], 'a product repo may classify its own profile');

  const product = profileDoc('infodot');
  product.kind = 'product';
  assert.match(validateProfileDoc(product, { location: 'brain' }).join('\n'), /belong in their product repository/);
});

test('extends rules: ecosystem has no parent, a product must have one, none extends itself', () => {
  const eco = profileDoc('dot-ecosystem');
  eco.extends = 'infodot@0.1.0';
  assert.match(validateProfileDoc(eco, { location: 'brain' }).join('\n'), /ecosystem profile has no parent/);
  const self = profileDoc('infodot');
  self.extends = 'infodot@0.1.0';
  assert.match(validateProfileDoc(self, { location: 'brain' }).join('\n'), /cannot extend itself/);
  const product = { ...profileDoc('infodot'), kind: 'product' };
  delete product.extends;
  assert.match(checkProfile(product, { location: 'product' }).join('\n'), /must extend a brand or ecosystem profile/);
});

test('supersedes must name a lower version of the same profile', () => {
  const doc = profileDoc('infodot');
  doc.version = '0.2.0';
  doc.supersedes = 'infodot@0.1.0';
  assert.deepEqual(validateProfileDoc(doc, { location: 'brain' }), []);
  doc.supersedes = 'infodot@0.2.0';
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /lower than this one/);
  doc.supersedes = 'blupin@0.1.0';
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /same profile id/);
});

test('standards: adapted or not_applicable needs a rationale; a non-negotiable standard cannot be waived', () => {
  const doc = profileDoc('dot-ecosystem');
  const s = doc.experience_standards.find((x) => x.principle === 'BXP-07');
  s.stance = 'adapted';
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /requires a rationale/);
  const t = doc.experience_standards.find((x) => x.principle === 'BXP-11');
  t.stance = 'not_applicable';
  t.rationale = 'we do not care';
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /non-negotiable standard must apply/);
});

test('duplicate ids are rejected', () => {
  const doc = profileDoc('infodot');
  doc.unknowns.push(clone(doc.unknowns[0]));
  doc.behavioural_principles.push(clone(doc.behavioural_principles[0]));
  const errors = validateProfileDoc(doc, { location: 'brain' }).join('\n');
  assert.match(errors, /unknowns: duplicate entry/);
  assert.match(errors, /behavioural_principles: duplicate entry/);
});

test('relative path rule: nothing that can leave a checkout or reach .git', () => {
  for (const ok of ['PRODUCT.md', 'resources/css/app.css', 'docs/a.b.md']) assert.equal(checkRelativePath(ok), null, ok);
  for (const bad of ['', '/etc/passwd', '../x', 'a/../b', './x', 'a//b', 'a/', 'C:/x', 'a\\b', '.git/config', 'a\0b']) {
    assert.notEqual(checkRelativePath(bad), null, JSON.stringify(bad));
  }
  const doc = profileDoc('infodot');
  doc.visual_direction.source_refs[0].path = '../outside';
  assert.match(validateProfileDoc(doc, { location: 'brain' }).join('\n'), /source_refs\[0\]\.path: must not contain/);
});

test('engagement-related principles must carry the Dopemine constraint and human review', () => {
  const doc = readJsonFile(`${BRAND}framework/principles/BXP-09-habit-formation-continuing-value.json`);
  assert.deepEqual(validatePrincipleDoc(doc), []);
  const a = clone(doc);
  delete a.dopemine_constraint;
  assert.match(validatePrincipleDoc(a).join('\n'), /must state the Dopemine ethics constraint/);
  const b = clone(doc);
  b.dopemine_constraint = 'Be nice.';
  assert.match(validatePrincipleDoc(b).join('\n'), /must reference brain\.dopemine\.md/);
  const c = clone(doc);
  c.requires_human_review = false;
  assert.match(validatePrincipleDoc(c).join('\n'), /requires_human_review: must be true/);
  assert.deepEqual(checkPrinciple({ ...doc, engagement_related: false, dopemine_constraint: undefined, requires_human_review: undefined, status: 'draft', contributors: [AI] }).filter((e) => /dopemine|human_review/.test(e)), []);
});

test('a principle needs at least one validation method', () => {
  const doc = readJsonFile(`${BRAND}framework/principles/BXP-01-emotional-positioning.json`);
  doc.validation_method = { automated: [], expert_review: [], observed_behaviour: [], customer_feedback: [] };
  assert.match(validatePrincipleDoc(doc).join('\n'), /at least one validation method/);
});

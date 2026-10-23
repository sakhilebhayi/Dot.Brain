// Everything that ships in brand/ and schemas/ must be valid, honest and complete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND, ROOT, shipped } from './_helpers.js';

const reg = shipped();
const DIMENSIONS = [
  'emotional_clarity_positioning', 'brand_distinctiveness', 'usability_cognitive_load', 'visual_interaction_craftsmanship',
  'functional_completeness', 'trust_transparency', 'perceived_demonstrated_value', 'accessibility_inclusion',
  'cross_platform_consistency', 'reliability_error_recovery', 'retention_continuing_value', 'measurable_customer_outcomes',
];
const PRINCIPLE_FIELDS = ['id', 'slug', 'title', 'version', 'status', 'contributors', 'definition', 'intended_outcome', 'applicable_contexts', 'implementation_guidance', 'validation_method', 'limitations', 'evidence', 'rubric_dimensions', 'engagement_related', 'provenance', 'confidence'];

test('every shipped profile and principle loads, validates, cross-checks and resolves without error', () => {
  assert.deepEqual(reg.errors, []);
  assert.deepEqual([...reg.profiles.keys()].sort(), ['blupin', 'dot-ecosystem', 'infodot']);
});

test('the framework has exactly the 12 principles BXP-01 to BXP-12, each with every required field', () => {
  assert.deepEqual([...reg.principles.keys()].sort(), Array.from({ length: 12 }, (_, i) => `BXP-${String(i + 1).padStart(2, '0')}`));
  for (const p of reg.principles.values()) {
    for (const f of PRINCIPLE_FIELDS) assert.ok(p[f] !== undefined, `${p.id} lacks ${f}`);
    assert.ok(p.implementation_guidance.length >= 4, `${p.id} guidance should be concrete and plural`);
    assert.ok(p.limitations.length >= 2, `${p.id} states limitations`);
    assert.ok(p.definition.length > 80 && p.intended_outcome.length > 40, p.id);
  }
});

test('the framework covers the twelve topics of the brief, in order', () => {
  const expected = [
    'emotional-positioning', 'identity-professional-confidence', 'differentiation-recognisability', 'trust-transparency-reliability',
    'perceived-value-actual-usefulness', 'visual-craftsmanship-interaction-quality', 'ease-of-use-cognitive-load',
    'onboarding-time-to-first-result', 'habit-formation-continuing-value', 'retention-advocacy', 'accessibility-inclusive-design',
    'cross-platform-consistency',
  ];
  assert.deepEqual([...reg.principles.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => p.slug), expected);
});

test('every one of the twelve BXQS rubric dimensions is fed by at least one principle (names only; the rubric is a later increment)', () => {
  const fed = new Set([...reg.principles.values()].flatMap((p) => p.rubric_dimensions));
  assert.deepEqual([...fed].sort(), [...DIMENSIONS].sort());
});

test('seed rule: no principle launches on stronger evidence than a hypothesis, declared intent or an UNVERIFIED citation', () => {
  for (const p of reg.principles.values()) {
    for (const e of p.evidence) {
      assert.ok(['internal_hypothesis', 'declared_intent', 'documented_research'].includes(e.class), `${p.id}: ${e.class}`);
      if (e.class === 'documented_research') assert.equal(e.citation_verified, false, `${p.id}: a human has not verified this citation yet`);
    }
    assert.ok(p.evidence.some((e) => e.class === 'internal_hypothesis' || e.class === 'declared_intent'), p.id);
    assert.ok(p.confidence <= 0.6, `${p.id} confidence ${p.confidence}`);
  }
});

test('no profile or principle is ratified: only the owner ratifies', () => {
  for (const doc of [...reg.profiles.values(), ...reg.principles.values()]) {
    assert.notEqual(doc.status, 'ratified', doc.id);
    assert.equal(doc.status, 'draft', doc.id);
    assert.equal(doc.approver, undefined, doc.id);
    assert.equal(doc.ratified_at, undefined, doc.id);
    assert.ok(doc.contributors.every((c) => c.kind === 'ai'), `${doc.id}: only an AI contributor so far`);
  }
});

test('every shipped profile is public, has unknowns, and has only intended, unmeasured feelings', () => {
  for (const p of reg.profiles.values()) {
    assert.equal(p.classification, 'public', p.id);
    assert.ok(p.unknowns.length > 0, p.id);
    assert.ok(p.unknowns.some((u) => u.blocks_ratification), `${p.id} should say what blocks ratification`);
    assert.ok(p.emotional_promise.length > 0 && p.emotional_promise.every((e) => e.label === 'intended' && e.measured === false), p.id);
    assert.notEqual(p.kind, 'product', 'product profiles live in their own repositories');
    assert.ok(p.language.claims_policy.forbidden.length > 0, `${p.id} has a claims policy`);
  }
});

test('Blupin: audience explicitly unknown, a claims policy forbidding performance, returns, authorisation and unsupported figures, no invented products', () => {
  const b = reg.profiles.get('blupin');
  assert.equal(b.kind, 'brand');
  assert.equal(b.extends, undefined);
  assert.equal(b.audience.length, 1);
  assert.equal(b.audience[0].segment, 'unknown');
  assert.equal(b.audience[0].identified, false);
  const ids = b.language.claims_policy.forbidden.map((f) => f.id);
  for (const id of ['no-performance-claims', 'no-return-claims', 'no-authorisation-claims', 'no-unsupported-figures']) assert.ok(ids.includes(id), id);
  const text = JSON.stringify(b.language.claims_policy.forbidden).toLowerCase();
  for (const word of ['performance', 'returns', 'authorised', 'licensed', 'figure']) assert.ok(text.includes(word), word);
  assert.ok(b.unknowns.some((u) => u.id === 'u-products' && /No shipping product with an audience/.test(u.question)));
  assert.deepEqual(b.visual_direction.source_refs, []);
  assert.equal(b.positioning.confidence, 0);
  assert.equal(b.confidence, 0.2);
});

test('the ecosystem profile shares principles only: no visual identity, platforms keep their own functional identities', () => {
  const e = reg.profiles.get('dot-ecosystem');
  assert.equal(e.kind, 'ecosystem');
  assert.deepEqual(e.visual_direction.source_refs, []);
  assert.match(e.visual_direction.constraints.join(' '), /No shared visual identity/);
  assert.match(e.visual_direction.constraints.join(' '), /own identity in its own repository/);
  const ids = e.behavioural_principles.map((b) => b.id);
  for (const id of ['honest-states', 'accessibility-baseline', 'error-recovery', 'consistent-naming', 'no-dark-patterns', 'token-interoperability', 'own-functional-identity', 'brand-yields-to-domain']) {
    const item = e.behavioural_principles.find((b) => b.id === id);
    assert.ok(item, id);
    assert.equal(item.non_negotiable, true, id);
  }
  assert.ok(ids.length === 8);
  assert.equal(e.experience_standards.length, 12);
});

test('InfoDot: cites its product files by pointer and hash, flags the control-center conflict, forbids invented proof', () => {
  const i = reg.profiles.get('infodot');
  assert.equal(i.extends, 'dot-ecosystem@0.1.0');
  const refs = Object.fromEntries(i.visual_direction.source_refs.map((r) => [r.path, r]));
  for (const path of ['PRODUCT.md', 'DESIGN.md', 'resources/css/infodot.css', 'docs/infodot-ui-design-guide.md']) {
    assert.ok(refs[path], path);
    assert.equal(refs[path].repo, 'sakhilebhayi/InfoDot');
    assert.match(refs[path].sha256, /^[0-9a-f]{64}$/);
    assert.match(refs[path].commit, /^[0-9a-f]{40}$/);
  }
  assert.equal(refs['docs/infodot-ui-design-guide.md'].role, 'conflicting_guidance');
  const conflict = i.unknowns.find((u) => u.id === 'u-ui-guide-conflict');
  assert.ok(conflict && conflict.blocks_ratification);
  assert.match(conflict.question, /control center/);
  assert.ok(i.provenance.notes.some((n) => /control center/.test(n)));
  const claims = i.language.claims_policy.forbidden.map((f) => f.id);
  for (const id of ['no-invented-customer-counts', 'no-invented-testimonials', 'no-invented-compliance-claims']) assert.ok(claims.includes(id), id);
  assert.deepEqual(i.emotional_promise.map((e) => e.feeling).sort(), ['belonging', 'opportunity', 'practical guidance', 'progress', 'respected and equipped', 'understanding']);
  const text = JSON.stringify(i);
  assert.ok(!/#[0-9a-fA-F]{6}\b/.test(text), 'tokens are cited by hash, never copied');
});

test('no profile or principle contains private or personal material: emails, local paths, tokens', () => {
  const files = [
    ...readdirSync(join(BRAND, 'profiles')).map((f) => join(BRAND, 'profiles', f)),
    ...readdirSync(join(BRAND, 'framework', 'principles')).map((f) => join(BRAND, 'framework', 'principles', f)),
  ];
  assert.equal(files.length, 15);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/[\w.+-]+@[\w-]+\.[\w.-]+/.test(text.replace(/[a-z0-9-]+@\d+\.\d+\.\d+/g, '')), `${file}: email-like string`);
    assert.ok(!/\/Users\/|\/home\/|C:\\\\/.test(text), `${file}: local path`);
    assert.ok(!/(ghp_|github_pat_|sk-[A-Za-z0-9]{10}|Bearer\s+\S|AKIA[0-9A-Z]{8}|-----BEGIN)/.test(text), `${file}: token-like string`);
  }
});

test('profile and principle cross-references resolve against the framework at the pinned versions', () => {
  for (const p of reg.profiles.values()) {
    for (const s of p.experience_standards) {
      const principle = reg.principles.get(s.principle);
      assert.ok(principle, `${p.id} -> ${s.principle}`);
      assert.equal(s.principle_version, principle.version, `${p.id} pins ${s.principle}`);
    }
    for (const d of p.domain_overrides) assert.ok(reg.principles.has(d.principle), `${p.id} -> ${d.principle}`);
  }
  assert.deepEqual(reg.warnings, []);
});

test('the engagement-related principles are exactly the habit and retention principles, and say so', () => {
  const engagement = [...reg.principles.values()].filter((p) => p.engagement_related).map((p) => p.id).sort();
  assert.deepEqual(engagement, ['BXP-09', 'BXP-10']);
  for (const id of engagement) {
    const p = reg.principles.get(id);
    assert.equal(p.requires_human_review, true);
    assert.match(p.dopemine_constraint, /brain\.dopemine\.md section 2/);
    assert.match(p.implementation_guidance.join(' '), /never targets|requires_human_review/);
  }
  assert.match(reg.principles.get('BXP-09').implementation_guidance.join(' '), /streak length/);
});

test('both schema files and the data directory are where CODEOWNERS and the docs say they are', () => {
  const codeowners = readFileSync(`${ROOT}.github/CODEOWNERS`, 'utf8');
  assert.match(codeowners, /^\/brand\/\s+@sakhilebhayi$/m);
  assert.match(codeowners, /^\/schemas\/brand-profile\.schema\.json\s+@sakhilebhayi$/m);
  assert.match(codeowners, /^\/schemas\/brand-principle\.schema\.json\s+@sakhilebhayi$/m);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProfile, MAX_DEPTH } from '../src/resolve.js';
import { crossCheckProfile, lookupProfile, validateProfileDoc } from '../src/registry.js';
import { clone, profileDoc, shipped } from './_helpers.js';

/** An in-memory registry of cloned shipped profiles, so each test can break its own copy. */
function mem(mutate = () => {}) {
  const base = shipped();
  const profiles = new Map([...base.profiles].map(([k, v]) => [k, clone(v)]));
  const reg = { profiles, principles: base.principles, errors: [], warnings: [] };
  mutate(reg);
  return reg;
}

test('infodot resolves over dot-ecosystem: origins are recorded and the chain is root-last', () => {
  const reg = mem();
  const { resolved, errors, warnings } = resolveProfile(reg.profiles.get('infodot'), reg);
  assert.deepEqual(errors, []);
  assert.deepEqual(resolved.chain, ['infodot@0.1.0', 'dot-ecosystem@0.1.0']);
  const bp = Object.fromEntries(resolved.behavioural_principles.map((b) => [b.id, b]));
  assert.equal(bp['accessibility-baseline'].origin, 'dot-ecosystem@0.1.0');
  assert.equal(bp['ownership-signature'].origin, 'infodot@0.1.0');
  assert.equal(resolved.behavioural_principles.length, 8 + 6);
  assert.equal(resolved.experience_standards.length, 12, 'all twelve principles are bound after inheritance');
  const b04 = resolved.experience_standards.find((s) => s.principle === 'BXP-04');
  assert.equal(b04.stance, 'emphasised');
  assert.equal(b04.non_negotiable, true);
  assert.deepEqual(b04.expressions.map((e) => e.origin), ['dot-ecosystem@0.1.0', 'infodot@0.1.0']);
  assert.deepEqual(resolved.overrides_applied.map((o) => o.field).sort(), ['experience_standards:BXP-01', 'experience_standards:BXP-02', 'experience_standards:BXP-04', 'language.voice']);
  assert.ok(resolved.overrides_applied.every((o) => o.reason.length >= 20 && o.replaces === 'dot-ecosystem@0.1.0' && o.by === 'infodot@0.1.0'));
  assert.equal(resolved.language.voice.origin, 'infodot@0.1.0');
  // prohibitions accumulate
  assert.ok(resolved.language.banned_phrases.some((t) => t.text === 'seamless' && t.origin === 'dot-ecosystem@0.1.0'));
  assert.ok(resolved.visual_direction.prohibited.some((t) => t.origin === 'dot-ecosystem@0.1.0'));
  assert.ok(resolved.visual_direction.prohibited.some((t) => t.origin === 'infodot@0.1.0'));
  const claimIds = resolved.language.claims_policy.forbidden.map((f) => f.id);
  assert.ok(claimIds.includes('no-invented-numbers') && claimIds.includes('no-invented-customer-counts'));
  assert.ok(resolved.unknowns.some((u) => u.origin === 'dot-ecosystem@0.1.0') && resolved.unknowns.some((u) => u.origin === 'infodot@0.1.0'));
  // a draft chain is reported as draft, and the child is not hiding it
  assert.equal(resolved.effective_status, 'draft');
  assert.deepEqual(warnings, []);
});

test('a profile with no parent resolves to itself', () => {
  const reg = mem();
  const { resolved, errors } = resolveProfile(reg.profiles.get('blupin'), reg);
  assert.deepEqual(errors, []);
  assert.deepEqual(resolved.chain, ['blupin@0.1.0']);
  assert.deepEqual(resolved.overrides_applied, []);
});

test('resolution is deterministic', () => {
  const a = JSON.stringify(resolveProfile(mem().profiles.get('infodot'), mem()).resolved);
  const b = JSON.stringify(resolveProfile(mem().profiles.get('infodot'), mem()).resolved);
  assert.equal(a, b);
});

test('cycles are detected, with the path named', () => {
  const reg = mem((r) => {
    r.profiles.get('infodot').extends = 'blupin@0.1.0';
    r.profiles.get('blupin').extends = 'infodot@0.1.0';
  });
  const { resolved, errors } = resolveProfile(reg.profiles.get('infodot'), reg);
  assert.equal(resolved, null);
  assert.match(errors.join('\n'), /extends cycle: infodot -> blupin -> infodot/);
});

test('a longer cycle and a self-extension are also cycles', () => {
  const reg = mem((r) => {
    r.profiles.set('a', { ...clone(r.profiles.get('infodot')), id: 'a', extends: 'b@0.1.0' });
    r.profiles.set('b', { ...clone(r.profiles.get('infodot')), id: 'b', extends: 'c@0.1.0' });
    r.profiles.set('c', { ...clone(r.profiles.get('infodot')), id: 'c', extends: 'a@0.1.0' });
  });
  assert.match(resolveProfile(reg.profiles.get('a'), reg).errors.join('\n'), /extends cycle: a -> b -> c -> a/);
  const self = mem((r) => { r.profiles.get('infodot').extends = 'infodot@0.1.0'; });
  assert.match(resolveProfile(self.profiles.get('infodot'), self).errors.join('\n'), /extends cycle: infodot -> infodot/);
});

test('an unknown parent, a version mismatch and a kind violation are errors', () => {
  const unknown = mem((r) => { r.profiles.get('infodot').extends = 'nope@0.1.0'; });
  assert.match(resolveProfile(unknown.profiles.get('infodot'), unknown).errors.join('\n'), /unknown profile nope/);

  const version = mem((r) => { r.profiles.get('infodot').extends = 'dot-ecosystem@0.2.0'; });
  assert.match(resolveProfile(version.profiles.get('infodot'), version).errors.join('\n'), /extends dot-ecosystem@0\.2\.0, but the registry holds dot-ecosystem@0\.1\.0/);

  const kind = mem((r) => { r.profiles.get('dot-ecosystem').extends = 'blupin@0.1.0'; });
  assert.match(resolveProfile(kind.profiles.get('dot-ecosystem'), kind).errors.join('\n'), /cannot extend/);

  const brandOnBrand = mem((r) => { r.profiles.get('infodot').extends = 'blupin@0.1.0'; });
  assert.match(resolveProfile(brandOnBrand.profiles.get('infodot'), brandOnBrand).errors.join('\n'), /kind brand\) cannot extend blupin@0\.1\.0 \(kind brand\)/);
});

test('the chain depth is bounded: eight profiles resolve, a ninth is an error', () => {
  const chainOf = (n) => mem((r) => {
    for (let i = 0; i < n; i += 1) {
      r.profiles.set(`p${i}`, { ...clone(r.profiles.get('infodot')), id: `p${i}`, extends: i + 1 < n ? `p${i + 1}@0.1.0` : undefined });
    }
  });
  assert.equal(MAX_DEPTH, 8);
  const ok = chainOf(MAX_DEPTH);
  assert.doesNotMatch(resolveProfile(ok.profiles.get('p0'), ok).errors.join('\n'), /deeper than/);
  const deep = chainOf(MAX_DEPTH + 1);
  assert.match(resolveProfile(deep.profiles.get('p0'), deep).errors.join('\n'), /extends chain deeper than 8/);
});

test('replacing an inherited value without an override entry is an error naming the field', () => {
  const reg = mem((r) => { r.profiles.get('infodot').overrides = r.profiles.get('infodot').overrides.filter((o) => o.field !== 'language.voice'); });
  const { resolved, errors } = resolveProfile(reg.profiles.get('infodot'), reg);
  assert.equal(resolved, null);
  assert.match(errors.join('\n'), /the voice replaces a value inherited from dot-ecosystem@0\.1\.0 but has no override entry for "language\.voice"/);
});

test('every kind of replacement needs its own override: stance, behavioural principle, cited source', () => {
  const stance = mem((r) => { r.profiles.get('infodot').overrides = r.profiles.get('infodot').overrides.filter((o) => o.field !== 'experience_standards:BXP-02'); });
  assert.match(resolveProfile(stance.profiles.get('infodot'), stance).errors.join('\n'), /stance emphasised for BXP-02 .* "experience_standards:BXP-02"/);

  const text = mem((r) => {
    const i = r.profiles.get('infodot');
    i.behavioural_principles.push({ ...clone(r.profiles.get('dot-ecosystem').behavioural_principles.find((b) => b.id === 'own-functional-identity')), non_negotiable: false });
  });
  assert.match(resolveProfile(text.profiles.get('infodot'), text).errors.join('\n'), /cannot override non-negotiable behavioural principle own-functional-identity/);

  const refs = mem((r) => {
    r.profiles.get('dot-ecosystem').visual_direction.source_refs = [clone(r.profiles.get('infodot').visual_direction.source_refs[0])];
    r.profiles.get('dot-ecosystem').visual_direction.source_refs[0].sha256 = 'f'.repeat(64);
  });
  assert.match(resolveProfile(refs.profiles.get('infodot'), refs).errors.join('\n'), /source sakhilebhayi\/InfoDot\/DESIGN\.md|source sakhilebhayi\/InfoDot\/PRODUCT\.md/);
});

test('an override with a real reason is applied and recorded; a thin reason is refused', () => {
  const thin = mem((r) => { r.profiles.get('infodot').overrides[0].reason = 'because'; });
  assert.match(resolveProfile(thin.profiles.get('infodot'), thin).errors.join('\n'), /needs a real reason/);
  const ok = mem();
  const { resolved } = resolveProfile(ok.profiles.get('infodot'), ok);
  const o = resolved.overrides_applied.find((x) => x.field === 'language.voice');
  assert.match(o.reason, /more specific than the ecosystem default/);
});

test('an override that replaces nothing is an error, so the list stays an honest record', () => {
  const reg = mem((r) => { r.profiles.get('infodot').overrides.push({ field: 'experience_standards:BXP-09', reason: 'Nothing is actually replaced here, which must be reported.' }); });
  assert.match(resolveProfile(reg.profiles.get('infodot'), reg).errors.join('\n'), /override "experience_standards:BXP-09" does not replace anything inherited/);
  const root = mem((r) => { r.profiles.get('dot-ecosystem').overrides = [{ field: 'language.voice', reason: 'A root profile has nothing above it to replace.' }]; });
  assert.match(resolveProfile(root.profiles.get('dot-ecosystem'), root).errors.join('\n'), /does not replace anything inherited/);
});

test('non-negotiables cannot be overridden, even with a reason', () => {
  const stance = mem((r) => {
    const i = r.profiles.get('infodot');
    const s = i.experience_standards.find((x) => x.principle === 'BXP-12');
    s.stance = 'not_applicable';
    s.rationale = 'We would rather not.';
    s.non_negotiable = false;
    i.overrides.push({ field: 'experience_standards:BXP-12', reason: 'A perfectly articulate reason to opt out of this.' });
  });
  const errors = resolveProfile(stance.profiles.get('infodot'), stance).errors.join('\n');
  assert.match(errors, /cannot relax non-negotiable standard BXP-12/);
  assert.match(errors, /cannot set stance not_applicable on non-negotiable standard BXP-12/);

  const redefine = mem((r) => {
    const i = r.profiles.get('infodot');
    i.behavioural_principles.push({ ...clone(r.profiles.get('dot-ecosystem').behavioural_principles[0]), text: 'Honest states are optional here.' });
    i.overrides.push({ field: 'behavioural_principles:honest-states', reason: 'A perfectly articulate reason to loosen honesty.' });
  });
  assert.match(resolveProfile(redefine.profiles.get('infodot'), redefine).errors.join('\n'), /cannot override non-negotiable behavioural principle honest-states/);
});

test('the claims policy only grows: a child cannot redefine an inherited forbidden claim', () => {
  const reg = mem((r) => {
    r.profiles.get('infodot').language.claims_policy.forbidden.push({ id: 'no-invented-numbers', rule: 'Numbers are fine.' });
  });
  assert.match(resolveProfile(reg.profiles.get('infodot'), reg).errors.join('\n'), /cannot redefine forbidden claim no-invented-numbers/);
  // restating it identically is harmless
  const same = mem((r) => {
    const eco = r.profiles.get('dot-ecosystem').language.claims_policy.forbidden[0];
    r.profiles.get('infodot').language.claims_policy.forbidden.push(clone(eco));
  });
  assert.deepEqual(resolveProfile(same.profiles.get('infodot'), same).errors, []);
});

test('the effective status is the lowest in the chain, and a superseded parent is flagged', () => {
  const proposed = mem((r) => { r.profiles.get('infodot').status = 'proposed'; });
  const a = resolveProfile(proposed.profiles.get('infodot'), proposed);
  assert.equal(a.resolved.effective_status, 'draft', 'a proposed child cannot be better than its draft parent');
  assert.match(a.warnings.join('\n'), /infodot@0\.1\.0 \(proposed\) inherits from dot-ecosystem@0\.1\.0, which is only draft/);

  const superseded = mem((r) => { r.profiles.get('dot-ecosystem').status = 'superseded'; });
  const b = resolveProfile(superseded.profiles.get('infodot'), superseded);
  assert.equal(b.resolved.effective_status, 'superseded');
  assert.match(b.warnings.join('\n'), /dot-ecosystem@0\.1\.0 is superseded/);
});

test('framework cross-checks: unknown principle, a pin newer than the framework, a pin older than the framework', () => {
  const reg = mem();
  const doc = reg.profiles.get('infodot');
  doc.experience_standards.push({ principle: 'BXP-99', principle_version: '0.1.0', stance: 'applies', expression: 'x', non_negotiable: false });
  assert.match(crossCheckProfile(doc, reg).errors.join('\n'), /unknown principle BXP-99/);
  doc.experience_standards.pop();
  doc.experience_standards[0].principle_version = '0.9.0';
  assert.match(crossCheckProfile(doc, reg).errors.join('\n'), /newer than the framework's 0\.1\.0/);
  const old = mem();
  old.principles.get('BXP-01').version = '0.2.0';
  assert.match(crossCheckProfile(old.profiles.get('infodot'), old).warnings.join('\n'), /pins BXP-01@0\.1\.0; the framework is at 0\.2\.0/);
  const dom = mem();
  dom.profiles.get('infodot').domain_overrides[0].principle = 'BXP-77';
  assert.match(crossCheckProfile(dom.profiles.get('infodot'), dom).errors.join('\n'), /unknown principle BXP-77/);
});

test('lookupProfile accepts id and id@version and reports the wrong version', () => {
  const reg = mem();
  assert.equal(lookupProfile('infodot', reg).errors.length, 0);
  assert.equal(lookupProfile('infodot@0.1.0', reg).errors.length, 0);
  assert.match(lookupProfile('infodot@9.9.9', reg).errors.join(), /is at 0\.1\.0, not 9\.9\.9/);
  assert.match(lookupProfile('nonesuch', reg).errors.join(), /unknown profile nonesuch/);
});

test('shipped infodot validates standalone as a brain profile', () => {
  assert.deepEqual(validateProfileDoc(profileDoc('infodot'), { location: 'brain' }), []);
});

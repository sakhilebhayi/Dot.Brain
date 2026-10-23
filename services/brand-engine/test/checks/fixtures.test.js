// Known-good and known-bad synthetic checkouts: exact findings (rule, severity, file:line) per check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXTURES, PROFILE, brief, loadChecks, reasonOf, runOn, substantive } from './_helpers.js';

const checks = await loadChecks();
const GOOD = `${FIXTURES}good`;
const BAD = `${FIXTURES}bad`;

const APP = 'resources/css/app.css';
const HOME = 'resources/views/home.blade.php';
const LAYOUT = 'resources/views/layouts/app.blade.php';

// Every value below was worked out by hand from the fixture files (see the comments in the fixture CSS and views).
const BAD_EXPECTED = {
  'd1.copy_profile_language_lint': {
    // 24 strings (nav 3, home 9 + 1 placeholder, contact 1 + 9 aria-labels, list 1); 3 trip a banned phrase or a claim
    value: 21 / 24,
    findings: [`banned-phrase major ${HOME}:5`],
  },
  'd10.error_pages': {
    value: 0,
    findings: ['error-page-missing minor resources/views:1', 'error-page-missing major resources/views:1', 'error-page-missing minor resources/views:1', 'error-page-missing major resources/views:1', 'error-page-missing minor resources/views:1'],
  },
  'd10.health_endpoint': { value: 0, findings: ['health-endpoint-missing major routes:1'] },
  'd2.font_palette_deny_list': { value: 0, findings: [`font-on-deny-list minor ${APP}:28`] },
  'd3.field_counts': { value: 0.5, findings: ['form-too-many-fields minor resources/views/contact.blade.php:2'] },
  'd3.heading_structure': { value: 2 / 3, findings: [`heading-skip minor ${HOME}:4`] },
  'd3.nav_depth': { value: 2 / 3, findings: [`nav-too-deep minor ${LAYOUT}:12`] },
  'd4.reduced_motion': {
    value: 0,
    findings: [`motion-no-reduced-variant minor ${APP}:30`, `motion-no-reduced-variant major ${APP}:32`],
  },
  'd4.spacing_type_scale_conformance': {
    // spacing: badge var, card 13px, card margin var + 6px; type: body var, card 15px -> 3 of 6 conform
    value: 0.5,
    findings: [`off-scale-value minor ${APP}:30`],
  },
  'd5.dead_links': {
    // resolved: "/" in the nav, two form actions, route('contact'); dead: route('nope'), /pricing, /deep
    value: 4 / 7,
    findings: [`dead-internal-link major ${HOME}:15`, `dead-internal-link major ${LAYOUT}:11`, `dead-internal-link major ${LAYOUT}:12`],
  },
  'd5.route_inventory_vs_claims': { value: 0.5, findings: ['claim-without-route minor README.md:5'] },
  'd5.stubs_placeholders': { value: 0.75, findings: [`lorem-ipsum major ${HOME}:16`] },
  'd6.claim_lint': {
    value: 0,
    findings: [`invented-count blocker ${HOME}:5`, `compliance-claim blocker ${HOME}:6`, `returns-claim blocker ${HOME}:6`, `fake-urgency major ${HOME}:17`, `fake-urgency major ${HOME}:17`],
  },
  'd6.privacy_terms_present': { value: 0, findings: ['privacy-missing major resources/views:1', 'terms-missing major resources/views:1'] },
  'd8.focus_visible': { value: 0, findings: [`focus-outline-removed major ${APP}:31`, `focus-outline-removed major ${HOME}:15`] },
  'd8.labels_alt_lang': {
    // fields 10/11 labelled, images 1/2 with alt, documents 0/1 with lang
    value: 11 / 14,
    findings: [
      `img-alt-missing blocker ${HOME}:7`, `control-no-label major ${HOME}:10`, `name-missing major ${HOME}:14`,
      `html-lang-missing blocker ${LAYOUT}:2`, `title-missing major ${LAYOUT}:2`, `viewport-zoom-disabled blocker ${LAYOUT}:5`,
    ],
  },
  'd8.token_pair_contrast': {
    // 14 pair/theme combinations; 5 pass: --text on --bg and --panel (both themes) and --brand-ink on --brand (light)
    value: 5 / 14,
    findings: [
      `low-contrast major ${APP}:5`, `low-contrast major ${APP}:5`, `low-contrast major ${APP}:5`, `low-contrast major ${APP}:5`,
      `low-contrast major ${APP}:7`, `low-contrast major ${APP}:9`, `low-contrast major ${APP}:9`,
      `low-contrast blocker ${APP}:29`, `low-contrast blocker ${APP}:29`,
    ],
  },
  'd9.token_usage_vs_profile': {
    // tokens: bg, text, warn, muted (colour) + 3 spacing/type; non-tokens: #fff, #123456, #123457 + 13px, 6px, 15px
    value: 7 / 13,
    findings: [`hardcoded-colours info ${APP}:29`, `near-duplicate-colours minor ${APP}:34`],
  },
};

test('every built check has an expectation for the bad fixture (or is the honest-states check)', () => {
  const ids = [...checks.keys()].sort();
  assert.deepEqual([...Object.keys(BAD_EXPECTED), 'd6.honest_states'].sort(), ids);
});

for (const [id, want] of Object.entries(BAD_EXPECTED)) {
  test(`bad fixture: ${id} reports exactly the expected findings`, () => {
    const r = runOn(checks, id, BAD);
    assert.equal(r.status, 'measured', reasonOf(r));
    assert.equal(r.evidence.length, 1);
    assert.ok(Math.abs(r.evidence[0].result - want.value) < 0.0001, `value ${r.evidence[0].result}, expected ${want.value}`);
    assert.deepEqual(brief(r), want.findings);
    for (const f of r.findings) {
      assert.equal(f.check_id, id);
      assert.equal(f.dimension, checks.get(id).mod.dimension);
    }
  });
}

test('bad fixture: severities that matter downstream are blockers, heuristics are not', () => {
  const blockers = [];
  for (const [id] of checks) {
    const r = runOn(checks, id, BAD);
    for (const f of r.findings) if (f.severity === 'blocker') blockers.push(`${id} ${f.location.file}:${f.location.line} kind=${f.kind}`);
  }
  assert.deepEqual(blockers, [
    `d6.claim_lint ${HOME}:5 kind=unsupported_claim`,
    `d6.claim_lint ${HOME}:6 kind=unsupported_claim`,
    `d6.claim_lint ${HOME}:6 kind=unsupported_claim`,
    `d8.labels_alt_lang ${HOME}:7 kind=wcag_failure`,
    `d8.labels_alt_lang ${LAYOUT}:2 kind=wcag_failure`,
    `d8.labels_alt_lang ${LAYOUT}:5 kind=wcag_failure`,
    `d8.token_pair_contrast ${APP}:29 kind=wcag_failure`,
    `d8.token_pair_contrast ${APP}:29 kind=wcag_failure`,
  ]);
  // a non-blocker never carries a rubric finding kind
  for (const [id] of checks) for (const f of runOn(checks, id, BAD).findings) if (f.severity !== 'blocker') assert.equal(f.kind, undefined, `${id} ${f.id}`);
});

test('bad fixture: the honest-states check reports presence as info and never a value', () => {
  const r = runOn(checks, 'd6.honest_states', BAD);
  assert.equal(r.status, 'not_measured');
  assert.deepEqual(r.evidence, []);
  assert.deepEqual(brief(r), ['not-measured info -', 'list-empty-state-absent info resources/views/list.blade.php:1']);
  assert.match(reasonOf(r), /1 list screen\(s\) were inspected/);
});

test('bad fixture: quoted text stays short (the matched phrase plus context)', () => {
  const r = runOn(checks, 'd6.claim_lint', BAD);
  for (const f of r.findings) assert.ok(f.message.length < 330, f.message);
});

// ---- good ------------------------------------------------------------------------------------------

test('good fixture: no check produces a single finding of any severity', () => {
  for (const [id] of checks) {
    const r = runOn(checks, id, GOOD);
    assert.deepEqual(substantive(r), [], `${id} produced ${JSON.stringify(brief(r))}`);
  }
});

test('good fixture: every measurable check measures, and nothing is better than what was measured', () => {
  const values = {};
  for (const [id] of checks) {
    const r = runOn(checks, id, GOOD);
    if (id === 'd6.honest_states') { assert.equal(r.status, 'not_measured'); continue; }
    assert.equal(r.status, 'measured', `${id}: ${reasonOf(r)}`);
    values[id] = r.evidence[0].result;
  }
  // everything is 1 except the health endpoint, which can only be 2/3 without a running app ("answers" is never measured)
  for (const [id, v] of Object.entries(values)) assert.equal(v, id === 'd10.health_endpoint' ? 0.6667 : 1, id);
});

test('the profile can be absent: copy lint is not_measured, generic claim lint still runs', () => {
  const r1 = runOn(checks, 'd1.copy_profile_language_lint', BAD, null);
  assert.equal(r1.status, 'not_measured');
  assert.match(reasonOf(r1), /no profile/);
  const r2 = runOn(checks, 'd6.claim_lint', BAD, null);
  assert.equal(r2.status, 'measured');
  assert.equal(r2.findings.length, 5);
  assert.match(r2.evidence[0].detail, /No profile was resolved/);
});

test('a profile that names a claims policy attributes the finding to its rules', () => {
  const r = runOn(checks, 'd6.claim_lint', BAD, PROFILE);
  const count = r.findings.find((f) => f.id.includes('invented-count'));
  assert.match(count.message, /Claims policy: no-invented-customer-counts/);
  const returns = r.findings.find((f) => f.id.includes('returns-claim'));
  assert.match(returns.message, /no-performance-claims/);
});

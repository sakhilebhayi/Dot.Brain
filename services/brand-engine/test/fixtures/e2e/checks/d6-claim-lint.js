// FIXTURE check module (not the real d6.claim_lint): flags customer-count claims, which the fixture
// profile's claims policy forbids without a cited source.
const CLAIM = /\b(?:trusted by|used by)\s+[\d,]+\+?\s+(?:businesses|customers|shops)\b/i;
export default {
  id: 'd6.claim_lint',
  dimension: 'trust_transparency',
  title: 'Claim lint (fixture)',
  appliesTo: (ctx) => ctx.files.list('public/**/*.html').length > 0,
  run(ctx) {
    let claims = 0;
    let bad = 0;
    const findings = [];
    for (const file of ctx.files.list('public/**/*.html')) {
      (ctx.files.read(file) ?? '').split('\n').forEach((l, i) => {
        const text = l.replace(/<[^>]+>/g, ' ');
        if (!/\S/.test(text)) return;
        claims += 1;
        if (CLAIM.test(text)) {
          bad += 1;
          findings.push({ id: `claim-${file}-${i + 1}`, severity: 'blocker', dimension: 'trust_transparency', check_id: 'd6.claim_lint', message: 'A customer-count claim has no cited source', location: { file, line: i + 1 }, fix_hint: 'Remove the figure or replace it with a claim the product can support, with its source.', kind: 'unsupported_claim' });
        }
      });
    }
    return { status: 'measured', evidence: [{ check_id: 'd6.claim_lint', source_class: 'automated_check', result: claims === 0 ? 1 : (claims - bad) / claims, detail: `${claims - bad} of ${claims} text lines pass the claims policy`, artifact_ref: 'public/' }], findings };
  },
};

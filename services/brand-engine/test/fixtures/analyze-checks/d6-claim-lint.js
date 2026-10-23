// FIXTURE: leaks a credential-shaped string in a message; the engine must redact it.
// Credential-SHAPED strings built at run time (a literal would trip secret scanners). Not real.
const TOKEN = `gh${'p'}_${'A1b2C3'.repeat(6)}`;
const BEARER = `Bear${'er'} ${'xYz9'.repeat(8)}`;
export default {
  id: 'd6.claim_lint', dimension: 'trust_transparency', title: 'Leaky claim lint (fixture)',
  appliesTo: () => true,
  run: (ctx) => ({
    status: 'measured',
    evidence: [{ check_id: 'd6.claim_lint', source_class: 'automated_check', result: 0.5, detail: `token ${TOKEN} found in a source file under ${ctx.root}/public` }],
    findings: [{ id: 'leak/1', severity: 'major', dimension: 'trust_transparency', check_id: 'd6.claim_lint', message: `Found ${BEARER} in copy`, fix_hint: 'Remove it.', location: { file: 'public/index.html', line: 2 } }],
  }),
};

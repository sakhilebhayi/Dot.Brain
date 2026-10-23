// FIXTURE: proves a check sees no environment variables.
export default {
  id: 'd8.fixture_env', dimension: 'accessibility_inclusion', title: 'Fixture env',
  appliesTo: () => true,
  run: () => ({ status: 'measured', evidence: [{ check_id: 'd8.fixture_env', source_class: 'automated_check', result: Object.keys(process.env).length === 0 ? 1 : 0, detail: 'env keys: ' + Object.keys(process.env).length }], findings: [] }),
};

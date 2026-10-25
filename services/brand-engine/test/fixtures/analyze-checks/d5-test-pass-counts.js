// FIXTURE: a module for a check id a test report also produces, so the two sources conflict.
export default {
  id: 'd5.test_pass_counts', dimension: 'functional_completeness', title: 'Duplicate source (fixture)',
  appliesTo: () => true,
  run: () => ({ status: 'measured', evidence: [{ check_id: 'd5.test_pass_counts', source_class: 'automated_check', result: 1 }], findings: [] }),
};

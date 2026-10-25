// FIXTURE: claims a dimension that is not the one its id belongs to.
export default {
  id: 'd3.nav_depth', dimension: 'accessibility_inclusion', title: 'Wrong dimension (fixture)',
  appliesTo: () => true,
  run: () => ({ status: 'measured', evidence: [{ check_id: 'd3.nav_depth', source_class: 'automated_check', result: 1 }], findings: [] }),
};

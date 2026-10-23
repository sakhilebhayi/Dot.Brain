// FIXTURE: honestly reports that it could not measure.
export default {
  id: 'd4.reduced_motion', dimension: 'visual_interaction_craftsmanship', title: 'Not measured (fixture)',
  appliesTo: () => true,
  run: () => ({ status: 'not_measured', evidence: [], findings: [] }),
};

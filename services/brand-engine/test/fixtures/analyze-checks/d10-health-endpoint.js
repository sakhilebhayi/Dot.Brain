// FIXTURE: declares itself not applicable.
export default {
  id: 'd10.health_endpoint', dimension: 'reliability_error_recovery', title: 'Not applicable (fixture)',
  appliesTo: () => false,
  run: () => { throw new Error('never runs'); },
};

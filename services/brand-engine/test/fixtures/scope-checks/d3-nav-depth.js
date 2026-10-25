// FIXTURE: reports the scope it was given in its evidence detail.
export default {
  id: 'd3.nav_depth', dimension: 'usability_cognitive_load', title: 'Echoes ctx.scope (fixture)',
  appliesTo: () => true,
  run: (ctx) => ({
    status: 'measured',
    evidence: [{ check_id: 'd3.nav_depth', source_class: 'automated_check', result: 1, detail: `scope=${JSON.stringify(ctx.scope)} frozen=${Object.isFrozen(ctx.scope)} listed=${ctx.files.list(['**/*']).length}` }],
    findings: [],
  }),
};

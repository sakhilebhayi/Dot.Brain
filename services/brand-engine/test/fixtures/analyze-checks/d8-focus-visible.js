// FIXTURE: returns evidence for a check id the rubric does not define.
export default {
  id: 'd8.focus_visible', dimension: 'accessibility_inclusion', title: 'Unknown evidence id (fixture)',
  appliesTo: () => true,
  run: () => ({ status: 'measured', evidence: [{ check_id: 'd8.made_up_check', source_class: 'automated_check', result: 1 }], findings: [] }),
};

// services/brand-engine/src/analyze/checks/_lib/skipped.js
//
// Rubric automated check ids that the built-in static checks deliberately do NOT implement, and why.
// The contract test requires every automated check id in the released rubric to be either built
// (a module in this folder) or listed here, never both and never neither. A reason is a fact about what the
// check needs, not a promise.
export const SKIPPED = Object.freeze({
  'd1.purpose_statement_present': 'needs the entry surface identified and the profile purpose terms matched; the entry view cannot be found reliably from templates alone because routes usually go through controllers',
  'd1.product_md_consistency': 'PRODUCT.md has no machine-readable audience, purpose or contradiction list; matching free prose to copy needs a person or a language model, and Brain has none',
  'd2.impeccable_detect_findings': 'needs an adapter for the report of `impeccable detect`; the detector is an external tool',
  'd2.token_uniqueness': 'needs the framework or template default token values to compare against; that reference data is not held in this repository',
  'd3.primary_action_per_screen': 'needs a rendered page: which action is visually primary is not in the markup',
  'd3.task_flow_step_counts': 'needs scripted task flows run in a browser',
  'd4.detector_clean': 'needs an adapter for the report of `impeccable detect`; the detector is an external tool',
  'd4.responsive_overflow': 'needs a browser at 375, 768 and 1280 pixels to see horizontal overflow. A static guess (a fixed-width sidebar) is not this check, which counts tested widths; a measurement file from a browser run is the honest input, through an adapter, not a new check',
  'd5.test_pass_counts': 'needs a test-run report from an adapter; these checks never run tests',
  'd6.consent_handling': 'needs a browser to observe what happens before and after consent',
  'd7.time_to_first_result': 'needs a scripted run in a browser against a declared budget',
  'd7.empty_state_guidance': 'whether an empty state tells the person what to do next is a judgement about wording; d6.honest_states reports only the presence of empty-state wording',
  'd7.value_above_fold': 'needs a rendered first screen',
  'd8.axe_violations': 'needs an adapter for an axe-core JSON report; axe runs in a browser',
  'd9.shared_components': 'needs the product\'s shared component set to compare against, which no profile declares',
  'd9.principle_diff': 'compares behavioural principles with the product, which is a judgement and not a static scan',
  'd10.error_path_tests': 'needs test results and the declared error paths from an adapter',
  'd10.error_copy_lint': 'error messages are thrown at run time and are only partly visible in templates; enumerating them needs the application to run',
});

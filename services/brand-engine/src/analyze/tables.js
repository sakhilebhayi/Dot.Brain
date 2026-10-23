// services/brand-engine/src/analyze/tables.js
//
// The small tables the workflow uses. They are code, not data in brand/,
// because they describe how THIS engine routes and estimates; the rubric
// (brand/rubrics) stays the only source of weights and check ids.

/** d<order> -> rubric dimension id, for the dimensions adapters and plans name. */
export const DIMENSION_BY_ORDER = Object.freeze({
  1: 'emotional_clarity_positioning', 2: 'brand_distinctiveness', 3: 'usability_cognitive_load',
  4: 'visual_interaction_craftsmanship', 5: 'functional_completeness', 6: 'trust_transparency',
  7: 'perceived_demonstrated_value', 8: 'accessibility_inclusion', 9: 'cross_platform_consistency',
  10: 'reliability_error_recovery', 11: 'retention_continuing_value', 12: 'measurable_customer_outcomes',
});

/** Check id -> the order of its dimension ("d8.axe_violations" -> 8). */
export const orderOfCheck = (checkId) => Number(/^d([0-9]{1,2})\./.exec(checkId)?.[1]);

/**
 * The BXP principle a dimension answers to, used to say WHY a task exists.
 * A check may refine it (CHECK_PRINCIPLE). Every value is checked against the
 * framework at plan time.
 */
export const PRINCIPLE_BY_DIMENSION = Object.freeze({
  emotional_clarity_positioning: 'BXP-01', brand_distinctiveness: 'BXP-03', usability_cognitive_load: 'BXP-07',
  visual_interaction_craftsmanship: 'BXP-06', functional_completeness: 'BXP-05', trust_transparency: 'BXP-04',
  perceived_demonstrated_value: 'BXP-05', accessibility_inclusion: 'BXP-11', cross_platform_consistency: 'BXP-12',
  reliability_error_recovery: 'BXP-04', retention_continuing_value: 'BXP-10', measurable_customer_outcomes: 'BXP-05',
});
export const CHECK_PRINCIPLE = Object.freeze({
  'd1.copy_profile_language_lint': 'BXP-02', 'd7.time_to_first_result': 'BXP-08', 'd7.empty_state_guidance': 'BXP-08',
  'd3.heading_structure': 'BXP-11', 'd4.reduced_motion': 'BXP-11',
});

/**
 * Effort estimate per check (S, M or L). A guess for ORDERING only, stated as
 * such in every plan. A task that touches more than FILE_BUMP files is one
 * size larger. Anything not listed is M.
 */
export const EFFORT_BY_CHECK = Object.freeze({
  'd1.copy_profile_language_lint': 'S', 'd1.purpose_statement_present': 'S', 'd1.product_md_consistency': 'S',
  'd2.impeccable_detect_findings': 'M', 'd2.font_palette_deny_list': 'M', 'd2.token_uniqueness': 'L',
  'd3.nav_depth': 'L', 'd3.field_counts': 'M', 'd3.heading_structure': 'S', 'd3.primary_action_per_screen': 'M', 'd3.task_flow_step_counts': 'L',
  'd4.detector_clean': 'S', 'd4.spacing_type_scale_conformance': 'M', 'd4.reduced_motion': 'S', 'd4.responsive_overflow': 'M',
  'd5.test_pass_counts': 'M', 'd5.route_inventory_vs_claims': 'L', 'd5.dead_links': 'S', 'd5.stubs_placeholders': 'M',
  'd6.claim_lint': 'S', 'd6.privacy_terms_present': 'M', 'd6.consent_handling': 'L', 'd6.honest_states': 'M',
  'd7.time_to_first_result': 'L', 'd7.empty_state_guidance': 'M', 'd7.value_above_fold': 'M',
  'd8.token_pair_contrast': 'S', 'd8.axe_violations': 'M', 'd8.labels_alt_lang': 'S', 'd8.focus_visible': 'S',
  'd9.token_usage_vs_profile': 'L', 'd9.shared_components': 'L', 'd9.principle_diff': 'M',
  'd10.error_path_tests': 'M', 'd10.error_pages': 'M', 'd10.health_endpoint': 'S', 'd10.error_copy_lint': 'S',
});
export const EFFORT_UNITS = Object.freeze({ S: 1, M: 3, L: 8 });
export const EFFORT_ORDER = ['S', 'M', 'L'];
export const FILE_BUMP = 5;

/**
 * Dimensions where a brand rule is the reason for a change. A task in one of
 * these can be withheld when the profile says its principle yields to a
 * domain concern that currently has an open blocker.
 */
export const BRAND_DIMENSIONS = Object.freeze(['emotional_clarity_positioning', 'brand_distinctiveness', 'usability_cognitive_load', 'visual_interaction_craftsmanship', 'perceived_demonstrated_value', 'cross_platform_consistency']);
/** Outcome-defined dimensions: engagement lives here, so they always go to a person. */
export const ENGAGEMENT_DIMENSIONS = Object.freeze(['retention_continuing_value', 'measurable_customer_outcomes']);
export const ENGAGEMENT_PRINCIPLES = Object.freeze(['BXP-09', 'BXP-10']);

/** profile.domain_overrides[].yields_to -> the finding dimensions/kinds that count as an open domain concern. */
export const DOMAIN_CONCERN = Object.freeze({
  accessibility: { dimensions: ['accessibility_inclusion'], kinds: ['wcag_failure'] },
  functional_correctness: { dimensions: ['functional_completeness'], kinds: ['failing_test'] },
  regulation: { dimensions: ['trust_transparency'], kinds: ['unsupported_claim', 'domain_override_violation'] },
  security: { dimensions: [], kinds: ['domain_override_violation'] },
  domain_safety: { dimensions: [], kinds: ['domain_override_violation'] },
});

// The event taxonomy for user interaction intelligence (R-12), version 1.0.0.
//
// Principles (ADR-0025): only events that help explain an OUTCOME are in the list; an event carries the minimum fields;
// nothing here can hold what a person typed, read or was shown. Adding a type is a schema version change.

export const SCHEMA_VERSION = '1.0.0';

export const STATUSES = ['success', 'failure', 'abandoned', 'partial', 'unknown'];

export const ERROR_CATEGORIES = ['validation', 'network', 'timeout', 'server', 'client', 'permission', 'not_found', 'rate_limited', 'unknown'];

export const CONSENT_BASES = ['consent', 'contract', 'legitimate_interest', 'aggregate_only'];

// type -> which statuses it may carry, and which optional blocks it may carry
export const EVENT_TYPES = {
  'nav.view': { statuses: ['success', 'failure'], blocks: ['perf'] },
  'nav.loop': { statuses: ['unknown'], blocks: ['counts'], counts: ['loop_count'] },
  'ui.click': { statuses: ['success', 'failure', 'unknown'], blocks: [] },
  'ui.repeat_click': { statuses: ['failure', 'unknown'], blocks: ['counts'], counts: ['repeat_count'] },
  'form.start': { statuses: ['unknown'], blocks: [] },
  'form.validation_failed': { statuses: ['failure'], blocks: ['error', 'counts'], counts: ['field_count_failed'] },
  'form.submit': { statuses: ['success', 'failure'], blocks: ['error', 'perf'] },
  'form.complete': { statuses: ['success'], blocks: ['perf'] },
  'form.abandon': { statuses: ['abandoned'], blocks: ['perf'] },
  'search.run': { statuses: ['success', 'failure'], blocks: ['counts', 'flags', 'perf'], counts: ['query_length', 'results_count'], flags: ['reformulated'] },
  'search.empty': { statuses: ['failure'], blocks: ['counts', 'flags'], counts: ['query_length'], flags: ['reformulated'] },
  'feature.discover': { statuses: ['success'], blocks: [] },
  'feature.use': { statuses: ['success', 'failure', 'partial'], blocks: ['perf'] },
  'workflow.step': { statuses: ['success', 'failure', 'partial'], blocks: ['perf', 'error'], needsWorkflow: true },
  'workflow.complete': { statuses: ['success'], blocks: ['perf'], needsWorkflow: true },
  'workflow.abandon': { statuses: ['abandoned'], blocks: ['perf'], needsWorkflow: true },
  'request.failed': { statuses: ['failure'], blocks: ['error', 'perf'] },
  'request.slow': { statuses: ['partial', 'success'], blocks: ['perf'] },
  'error.shown': { statuses: ['failure'], blocks: ['error'] },
  'help.open': { statuses: ['unknown'], blocks: [] },
  'help.dismiss': { statuses: ['abandoned', 'unknown'], blocks: [] },
  'goal.complete': { statuses: ['success'], blocks: ['perf'], needsWorkflow: true },
  'recovery.success': { statuses: ['success'], blocks: ['error'] },
};

export const LIMITS = {
  maxEventBytes: 2048,
  maxBatch: 50,
  maxFutureMs: 5 * 60 * 1000,
  maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  maxDurationMs: 600000,
  maxCount: 100000,
};

// Fields that exist on an event, and the only places each may appear.
export const TOP_LEVEL = ['event_id', 'occurred_at', 'schema_version', 'product', 'tenant', 'session', 'type', 'name', 'route', 'status', 'workflow', 'perf', 'error', 'counts', 'flags', 'consent', 'instrument'];
export const REQUIRED = ['event_id', 'occurred_at', 'schema_version', 'product', 'session', 'type', 'name', 'status', 'consent'];

import test from 'node:test';
import assert from 'node:assert/strict';
import { reason, trackRecordFor, AUTONOMY_LADDER } from '../src/reason.js';

const proposal = { action_kind: 'retention_followup', risk: 0.2, recommendation: 'Follow up personally.' };

function context(worked = []) {
  return { known: true, what_worked: worked };
}

test('with no history at all, nothing may be acted on unattended', () => {
  const d = reason({ context: { known: false }, proposal, policy: { autonomy_ceiling: 'autonomous' } });

  assert.equal(d.action, 'recommend');
  assert.equal(d.confidence, 0.3);
  assert.match(d.rationale.join(' '), /Nothing has ever been recorded/);
});

test('a strong track record earns confidence and unattended action', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 5, graded: 5, improved: 5, worsened: 0, success_rate: 1 }]),
    proposal,
    policy: { autonomy_ceiling: 'autonomous' },
  });

  assert.equal(d.confidence, 0.8);
  assert.equal(d.autonomy_level, 'autonomous');
  assert.equal(d.action, 'execute');
  assert.equal(d.requires_approval, false);
});

test('one good result is an anecdote, not a rate', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 1, graded: 1, improved: 1, worsened: 0, success_rate: 1 }]),
    proposal,
    policy: { autonomy_ceiling: 'autonomous' },
  });

  assert.equal(d.confidence, 0.5);
  assert.equal(d.action, 'recommend');
  assert.match(d.rationale.join(' '), /too few to read as a rate/);
});

test('a poor track record lowers confidence below the bar', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 4, graded: 4, improved: 1, worsened: 2, success_rate: 0.25 }]),
    proposal,
    policy: { autonomy_ceiling: 'autonomous' },
  });

  assert.ok(d.confidence < 0.5);
  assert.equal(d.action, 'recommend');
  assert.match(d.rationale.join(' '), /made things worse/);
});

test('high risk always routes to a person, however good the history', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 9, graded: 9, improved: 9, worsened: 0, success_rate: 1 }]),
    proposal: { ...proposal, risk: 0.9 },
    policy: { autonomy_ceiling: 'autonomous' },
  });

  assert.equal(d.autonomy_level, 'approve');
  assert.equal(d.requires_approval, true);
  assert.match(d.rationale.join(' '), /a person signs this off/);
});

test('an operator ceiling cannot be argued past by evidence', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 9, graded: 9, improved: 9, worsened: 0, success_rate: 1 }]),
    proposal,
    policy: { autonomy_ceiling: 'recommend' },
  });

  assert.equal(d.autonomy_level, 'recommend');
  assert.equal(d.action, 'recommend');
  assert.match(d.rationale.join(' '), /Operator policy caps/);
});

test('with no action proposed there is nothing to authorise', () => {
  const d = reason({ context: context(), proposal: {}, policy: { autonomy_ceiling: 'autonomous' } });

  assert.equal(d.autonomy_level, 'observe');
  assert.equal(d.action, 'observe');
});

test('every decision explains itself', () => {
  const d = reason({ context: context(), proposal });

  assert.ok(d.rationale.length > 0, 'a decision with no stated reasons is not explainable');
  assert.ok(d.rationale.every((line) => typeof line === 'string' && line.length > 0));
});

test('the ladder only ever weakens -- gates cannot promote', () => {
  const d = reason({
    context: context([{ action_kind: 'retention_followup', attempts: 9, graded: 9, improved: 9, worsened: 0, success_rate: 1 }]),
    proposal: { ...proposal, risk: 0.9 },
    policy: { autonomy_ceiling: 'autonomous' },
  });

  assert.ok(AUTONOMY_LADDER.indexOf(d.autonomy_level) < AUTONOMY_LADDER.indexOf('autonomous'));
});

test('trackRecordFor returns an empty record for an unseen action kind', () => {
  assert.deepEqual(
    trackRecordFor(context([{ action_kind: 'something_else', attempts: 3, graded: 3, improved: 3, success_rate: 1 }]), 'retention_followup'),
    { attempts: 0, graded: 0, improved: 0, worsened: 0, success_rate: 0 },
  );
});

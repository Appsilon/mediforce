import type { AuditEvent } from './audit-event';

/**
 * How much of an auditor's attention a record deserves: `decision` is a person
 * exercising judgement, `transition` is the run moving, `routine` is the
 * machinery talking to itself.
 *
 * A compliance classification rather than a display preference, so it lives
 * beside the schema. Nothing is dropped on the strength of it — equal
 * prominence is a presentation choice, retention is not.
 */
export type AuditSignificance = 'decision' | 'transition' | 'routine';

/** Judgement calls, when a person is the one making them. */
const HUMAN_DECISION_ACTIONS: ReadonlySet<string> = new Set([
  'task.completed',
  'instance.cancelled',
  'step.retried',
  'step.autonomy_overridden',
  'workflow.access_changed',
]);

/** Judgement calls whoever the actor is — an agent escalating is a decision. */
const DECISION_ACTIONS: ReadonlySet<string> = new Set([
  'agent.escalated',
  'agent.fallback_triggered',
]);

const TRANSITION_ACTIONS: ReadonlySet<string> = new Set([
  'instance.created',
  'instance.started',
  'instance.completed',
  'instance.failed',
  'agent.run',
  'agent.step.started',
]);

const ROUTINE_ACTIONS: ReadonlySet<string> = new Set([
  'task.viewed',
  'task.created',
  'task.claimed',
  // Only reaches here when the actor was not a person: the engine closing a
  // task out is bookkeeping, the same action by a human is the decision above.
  'task.completed',
  'step.completed',
  'process.run.started',
  'process.run.step.started',
  'process.resumed_after_task',
]);

export function auditSignificance(event: Pick<AuditEvent, 'action' | 'actorType'>): AuditSignificance {
  if (DECISION_ACTIONS.has(event.action)) return 'decision';
  if (event.actorType === 'user' && HUMAN_DECISION_ACTIONS.has(event.action)) return 'decision';
  if (TRANSITION_ACTIONS.has(event.action)) return 'transition';
  if (ROUTINE_ACTIONS.has(event.action)) return 'routine';
  // An action nobody has classified is shown, not collapsed. A new record type
  // hiding itself is the failure mode that matters here.
  return 'transition';
}

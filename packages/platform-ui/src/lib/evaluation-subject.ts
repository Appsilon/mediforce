import { evaluationSubjectOf, type EvaluationOwner, type EvaluationSubject } from '@mediforce/platform-core';
import { routes } from './routes';

/** The subject an Evaluation row belongs to: a workflow Step, or an Agent evaluated on its own (ADR-0029). */
export function subjectOfRow(row: EvaluationOwner): EvaluationSubject {
  const subject = evaluationSubjectOf(row);
  if (subject === null) throw new Error('An Evaluation row names neither a step nor an agent');
  return subject;
}

/** Where an Eval Run of `subject` is read: under its workflow, or under its Agent. */
export function evalRunHref(subject: EvaluationSubject, evalRunId: string): string {
  return subject.kind === 'agent'
    ? routes.agentEvalRun(subject.namespace, subject.agentId, evalRunId)
    : routes.workflowEvalRun(subject.namespace, subject.workflowName, evalRunId);
}

/** Where one trial of an Eval Run of `subject` is read. */
export function evalTrialHref(subject: EvaluationSubject, evalRunId: string, trialId: string): string {
  return subject.kind === 'agent'
    ? routes.agentEvalTrial(subject.namespace, subject.agentId, evalRunId, trialId)
    : routes.workflowEvalTrial(subject.namespace, subject.workflowName, evalRunId, trialId);
}

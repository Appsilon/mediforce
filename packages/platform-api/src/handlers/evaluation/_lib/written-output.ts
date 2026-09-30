import type { AgentOutputEnvelope, EvaluatedStep, WrittenOutput } from '@mediforce/platform-core';
import type { CallerScope } from '../../../repositories/index';
import { NotFoundError, ValidationError } from '../../../errors';
import { isSameStep } from './evaluated-step';
import type { JudgedOutput } from './run-evaluator-check';

/** A live written output of `step`: another workspace's reads as missing, an archived one is refused. */
export async function loadWrittenOutput(scope: CallerScope, writtenOutputId: string, step: EvaluatedStep): Promise<WrittenOutput> {
  const writtenOutput = await scope.evaluation.getWrittenOutput(writtenOutputId);
  if (writtenOutput === null) throw new NotFoundError(`Written output '${writtenOutputId}' not found`);
  if (isSameStep(writtenOutput, step) === false) {
    throw new ValidationError(`Written output '${writtenOutputId}' is not an output of step '${step.stepId}' in '${step.workflowName}'`);
  }
  if (writtenOutput.archived) throw new ValidationError(`Written output '${writtenOutputId}' is archived`);
  return writtenOutput;
}

/** A written output as a judge reads it: its result, with no summary of the agent's own. */
export function judgedWrittenOutput(writtenOutput: WrittenOutput): JudgedOutput {
  const envelope: AgentOutputEnvelope = {
    duration_ms: 0,
    result: writtenOutput.result,
    annotations: [],
    confidence: 1,
    reasoning_summary: '',
    reasoning_chain: [],
    model: null,
  };
  return {
    id: writtenOutput.id,
    namespace: writtenOutput.namespace,
    stepId: writtenOutput.stepId,
    processInstanceId: null,
    envelope,
    stepInput: writtenOutput.stepInput,
  };
}

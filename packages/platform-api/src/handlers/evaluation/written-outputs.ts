import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type {
  ArchiveWrittenOutputInputSchema,
  CreateWrittenOutputInputSchema,
  CreateWrittenOutputOutput,
  ListWrittenOutputsInputSchema,
  ListWrittenOutputsOutput,
  WrittenOutputOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { loadGatedAgentRun, loadStepInput } from './_lib/evaluation-subject';
import { appendEvaluationAudit, authorId } from './_lib/audit';
import { labelEvaluatorOutput } from './evaluator-trust';

export async function listWrittenOutputs(
  input: z.output<typeof ListWrittenOutputsInputSchema>,
  scope: CallerScope,
): Promise<ListWrittenOutputsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  const writtenOutputs = await scope.evaluation.listWrittenOutputs(stepRef(input));
  return { writtenOutputs: input.includeArchived === true ? writtenOutputs : writtenOutputs.filter((row) => !row.archived) };
}

/**
 * A person's written example of the step's output (ADR-0023 D9), for a judge
 * to be calibrated on where production has no such output. Started from a
 * production run, it takes that run's input unless one is given; with
 * `label`, it is labelled for that Evaluator in the same write.
 */
export async function createWrittenOutput(
  input: z.output<typeof CreateWrittenOutputInputSchema>,
  scope: CallerScope,
): Promise<CreateWrittenOutputOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  let stepInput = input.stepInput ?? null;
  if (input.basedOnAgentRunId !== undefined) {
    const { agentRun, instance } = await loadGatedAgentRun(scope, input.basedOnAgentRunId, step);
    if (instance.evalRunId !== undefined) throw new ValidationError(`Agent Run '${input.basedOnAgentRunId}' is an eval trial, not a production run`);
    stepInput = input.stepInput === undefined ? await loadStepInput(scope, agentRun, instance) : stepInput;
  }

  const writtenOutput = await scope.evaluation.createWrittenOutput({
    ...step,
    id: randomUUID(),
    stepInput,
    result: input.result,
    basedOnAgentRunId: input.basedOnAgentRunId ?? null,
    note: input.note === undefined || input.note === '' ? null : input.note,
    origin: input.origin,
    archived: false,
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'eval_written_output.created',
    description: `Written output added to step '${step.stepId}'${writtenOutput.basedOnAgentRunId === null ? '' : ` from Agent Run '${writtenOutput.basedOnAgentRunId}'`}${writtenOutput.origin === 'assistant' ? ', drafted by the Evaluation Assistant' : ''}`,
    namespace: step.namespace,
    entityType: 'eval_written_output',
    entityId: writtenOutput.id,
    inputSnapshot: { ...step, basedOnAgentRunId: writtenOutput.basedOnAgentRunId, result: writtenOutput.result, origin: writtenOutput.origin },
    basis: 'A written output is a person\'s example of a Step\'s output, labelled to calibrate a judge (ADR-0023 D9)',
  });

  const score = input.label === undefined
    ? null
    : (await labelEvaluatorOutput({ ...input.label, writtenOutputId: writtenOutput.id, ...(input.uid === undefined ? {} : { uid: input.uid }) }, scope)).score;
  return { writtenOutput, score };
}

export async function archiveWrittenOutput(
  input: z.output<typeof ArchiveWrittenOutputInputSchema>,
  scope: CallerScope,
): Promise<WrittenOutputOutput> {
  const writtenOutput = await scope.evaluation.getWrittenOutput(input.writtenOutputId);
  if (writtenOutput === null) throw new NotFoundError(`Written output '${input.writtenOutputId}' not found`);
  await loadEvaluatedStep(scope, stepRef(writtenOutput), 'edit');
  await scope.evaluation.setWrittenOutputArchived(writtenOutput, input.archived);
  await appendEvaluationAudit(scope, {
    action: input.archived ? 'eval_written_output.archived' : 'eval_written_output.restored',
    description: `Written output ${input.archived ? 'archived' : 'restored'} on step '${writtenOutput.stepId}'`,
    namespace: writtenOutput.namespace,
    entityType: 'eval_written_output',
    entityId: writtenOutput.id,
    inputSnapshot: { archived: input.archived },
    basis: 'An archived written output leaves every Evaluator\'s labels and calibration',
  });
  return { writtenOutput: { ...writtenOutput, archived: input.archived } };
}

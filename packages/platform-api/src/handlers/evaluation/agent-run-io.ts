import type { GetAgentRunIoInput, GetAgentRunIoOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep } from './_lib/evaluated-step';
import { loadGatedAgentRun, loadStepInput } from './_lib/evaluation-subject';
import { caseInputOf } from './_lib/case-source';

/**
 * One Agent Run as an input/output pair: what its step was given and what it
 * returned — what a person looks at before adding the run as an Eval Case or
 * labelling its output. Readable by whoever may read the step's Evaluation.
 */
export async function getAgentRunIo(input: GetAgentRunIoInput, scope: CallerScope): Promise<GetAgentRunIoOutput> {
  const { agentRun, instance } = await loadGatedAgentRun(scope, input.agentRunId);
  await loadEvaluatedStep(scope, { namespace: instance.namespace ?? '', workflowName: instance.definitionName, stepId: agentRun.stepId }, 'read');
  const stepInput = await loadStepInput(scope, agentRun, instance);
  return {
    agentRunId: agentRun.id,
    status: agentRun.status,
    stepInput,
    caseInput: caseInputOf(instance, stepInput),
    result: agentRun.envelope?.result ?? null,
    reasoningSummary: agentRun.envelope?.reasoning_summary ?? null,
    confidence: agentRun.envelope?.confidence ?? null,
  };
}

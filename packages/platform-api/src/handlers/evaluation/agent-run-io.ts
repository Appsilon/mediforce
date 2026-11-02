import type { GetAgentRunIoInput, GetAgentRunIoOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluationSubject } from './_lib/evaluation-subject';
import { loadGatedAgentRun, loadStepInput, runSubjectRef } from './_lib/scored-run';
import { caseInputOf, loadFirstRound, loadVerdictLabel, type VerdictLabel } from './_lib/case-source';
import { loadAgentRunSource } from './_lib/agent-production-runs';

function verdictFields(label: VerdictLabel | null) {
  return {
    verdictExpectation: label?.expectation ?? null,
    verdictComparison: label?.comparison ?? null,
    verdictAgreementInstructions: label?.agreementInstructions ?? null,
  };
}

/**
 * One Agent Run as an input/output pair: what its step was given and what it
 * returned — what a person looks at before adding the run as an Eval Case or
 * labelling its output. Readable by whoever may read its subject's Evaluation.
 * With an Agent named, the run of a Step that uses it as a case of that Agent.
 */
export async function getAgentRunIo(input: GetAgentRunIoInput, scope: CallerScope): Promise<GetAgentRunIoOutput> {
  if (input.namespace !== undefined && input.agentId !== undefined) return getAgentCaseRunIo(input.agentRunId, input.namespace, input.agentId, scope);
  const { agentRun, instance } = await loadGatedAgentRun(scope, input.agentRunId);
  await loadEvaluationSubject(scope, runSubjectRef(agentRun, instance), 'read');
  const stepInput = await loadStepInput(scope, agentRun, instance);
  return {
    agentRunId: agentRun.id,
    status: agentRun.status,
    stepInput,
    caseInput: caseInputOf(instance, await loadStepInput(scope, await loadFirstRound(scope, agentRun), instance)),
    result: agentRun.envelope?.result ?? null,
    reasoningSummary: agentRun.envelope?.reasoning_summary ?? null,
    confidence: agentRun.envelope?.confidence ?? null,
    ...verdictFields(await loadVerdictLabel(scope, agentRun.id)),
  };
}

async function getAgentCaseRunIo(agentRunId: string, namespace: string, agentId: string, scope: CallerScope): Promise<GetAgentRunIoOutput> {
  await loadEvaluationSubject(scope, { namespace, agentId }, 'read');
  const source = await loadAgentRunSource(scope, { kind: 'agent', namespace, agentId }, agentRunId);
  return {
    agentRunId,
    status: source.agentRun.status,
    stepInput: source.stepInput,
    caseInput: source.input,
    result: source.result,
    reasoningSummary: source.change.outputSchemaDiffers ? null : source.agentRun.envelope?.reasoning_summary ?? null,
    confidence: source.agentRun.envelope?.confidence ?? null,
    ...verdictFields(source.change.outputSchemaDiffers ? null : await loadVerdictLabel(scope, agentRunId)),
    agentChange: source.change,
  };
}

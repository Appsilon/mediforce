import {
  EVALUATION_ASSISTANT_DEFAULT_MODEL,
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  type EvaluationAssistantPlatformToolName,
  type EvaluatorCheck,
} from '@mediforce/platform-core';
import {
  ProposalViewSchema,
  type AskEvaluationAssistantInput,
  type AskEvaluationAssistantOutput,
  type EvaluationAssistantProgress,
  type PreparedEvalRun,
} from '../../contract/evaluation-assistant';
import type { PreviewEvaluatorOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { recordAssistantPrompt, runProposalToolLoop } from '../../assistant-core';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { loadEvaluatedStep, stepRef } from '../evaluation/_lib/evaluated-step';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPT, briefMessage, unattendedBudgetMessage } from './_lib/system-prompt';
import { executeEvaluationTool, type UnattendedGrant } from './_lib/run-evaluation-tool';
import { reviewEvaluationProposal, type PreviewedCheck } from './_lib/review-proposal';

// Leave room for paged trajectory reads and preview/repair cycles for several checks.
const MAX_TOOL_LOOP_ITERATIONS = 32;
const ASSISTANT_MAX_OUTPUT_TOKENS = 8000;

function preparedRun(result: unknown): PreparedEvalRun | null {
  if (result === null || typeof result !== 'object' || !('prepared' in result)) return null;
  const prepared = (result as { prepared: { evalRunId: string; budgetUsd: number; estimate: { totalUsd: number | null }; trials: number } }).prepared;
  return { evalRunId: prepared.evalRunId, budgetUsd: prepared.budgetUsd, estimatedUsd: prepared.estimate.totalUsd, trials: prepared.trials };
}

/**
 * One turn with a Step's Evaluation Assistant (ADR-0023 D14–D16), on the
 * shared assistant core. Reads and `preview_evaluator` run as the caller;
 * plans, Evaluators and their new versions, cases (harvested or synthesized),
 * outputs to label and Brief drafts come back as proposals, each reviewed
 * against the platform first — a proposed check carries its self-test on
 * real outputs; a prepared Eval Run comes back for the person to confirm — or
 * is started by the assistant itself, within `unattendedBudgetUsd` when the
 * person granted one for the request (D15). Failures are diagnosed and fixes
 * proposed as cards; nothing is applied to the step. The
 * Step's Evaluation Brief is sent every turn. `onProgress` hears each model
 * round and tool call as it runs.
 */
export async function askEvaluationAssistant(
  input: AskEvaluationAssistantInput,
  scope: CallerScope,
  onProgress?: (event: EvaluationAssistantProgress) => void,
): Promise<AskEvaluationAssistantOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'read');
  const apiKey = await requireOpenRouterApiKey(scope, step.namespace);
  const model = input.model ?? EVALUATION_ASSISTANT_DEFAULT_MODEL;

  await recordAssistantPrompt(scope, {
    namespace: step.namespace,
    model,
    messages: input.messages,
    ...(input.unattendedBudgetUsd === undefined ? {} : { extraInput: { unattendedBudgetUsd: input.unattendedBudgetUsd } }),
    action: 'evaluation_assistant.prompt',
    description: `Evaluation Assistant prompt for step '${step.stepId}' (model: ${model})`,
    basis: 'Evaluation Assistant request (ADR-0023 D14)',
    entityType: 'evaluation_assistant',
    entityId: `${step.workflowName}/${step.stepId}`,
    logTag: 'evaluation-assistant',
  });

  const [brief] = await scope.evaluation.listBriefs(step);
  const unattended: UnattendedGrant | undefined = input.unattendedBudgetUsd === undefined
    ? undefined
    : { remainingUsd: input.unattendedBudgetUsd, started: [] };
  const previewed: PreviewedCheck[] = [];
  const executePlatformTool = async (toolName: EvaluationAssistantPlatformToolName, args: unknown) => {
    const toolResult = await executeEvaluationTool(toolName, args, scope, { step, definition, workflowStep, ...(unattended === undefined ? {} : { unattended }) });
    if (toolName === 'preview_evaluator') {
      previewed.push({ check: (args as { check: EvaluatorCheck }).check, results: (toolResult as PreviewEvaluatorOutput).results });
    }
    return toolResult;
  };
  const result = await runProposalToolLoop({
    model,
    apiKey,
    messages: [
      { role: 'system', content: EVALUATION_ASSISTANT_SYSTEM_PROMPT },
      { role: 'system', content: `You are evaluating step '${step.stepId}' ("${workflowStep.name}") of workflow '${step.workflowName}' v${definition.version} in workspace '${step.namespace}'.` },
      { role: 'system', content: briefMessage(brief ?? null) },
      { role: 'system', content: unattendedBudgetMessage(input.unattendedBudgetUsd) },
      ...input.messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    proposalTools: EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
    platformTools: EVALUATION_ASSISTANT_PLATFORM_TOOLS,
    executePlatformTool,
    reviewProposal: (toolName, args) => reviewEvaluationProposal(toolName, args, scope, step, previewed),
    maxIterations: MAX_TOOL_LOOP_ITERATIONS,
    maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
    onProgress,
  });

  return {
    reply: result.reply,
    proposals: result.proposals.map(({ tool, arguments: proposed, evidence }) =>
      ProposalViewSchema.parse({ tool, arguments: proposed, ...evidence })),
    preparedEvalRuns: result.platformCalls
      .filter((call) => call.tool === 'prepare_eval_run')
      .flatMap((call) => {
        const prepared = preparedRun(call.result);
        return prepared === null ? [] : [prepared];
      }),
    startedEvalRuns: unattended?.started ?? [],
  };
}

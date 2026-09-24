import {
  EVALUATION_ASSISTANT_DEFAULT_MODEL,
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  EvaluationAssistantProposalSchema,
} from '@mediforce/platform-core';
import type {
  AskEvaluationAssistantInput,
  AskEvaluationAssistantOutput,
  PreparedEvalRun,
} from '../../contract/evaluation-assistant';
import type { CallerScope } from '../../repositories/index';
import { recordAssistantPrompt, runProposalToolLoop } from '../../assistant-core';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { loadEvaluatedStep, stepRef } from '../evaluation/_lib/evaluated-step';
import { EVALUATION_ASSISTANT_SYSTEM_PROMPT, briefMessage } from './_lib/system-prompt';
import { executeEvaluationTool } from './_lib/run-evaluation-tool';

// Investigations commonly need several reads before a preview and proposal.
// Keep this above the workflow assistant's cap so the Evaluation Assistant can
// inspect a step, runs and trajectories without failing before it can reply.
const MAX_TOOL_LOOP_ITERATIONS = 16;
const ASSISTANT_MAX_OUTPUT_TOKENS = 4000;

function preparedRun(result: unknown): PreparedEvalRun | null {
  if (result === null || typeof result !== 'object' || !('prepared' in result)) return null;
  const prepared = (result as { prepared: { evalRunId: string; budgetUsd: number; estimate: { totalUsd: number | null }; trials: number } }).prepared;
  return { evalRunId: prepared.evalRunId, budgetUsd: prepared.budgetUsd, estimatedUsd: prepared.estimate.totalUsd, trials: prepared.trials };
}

/**
 * One turn with a Step's Evaluation Assistant (ADR-0023 D14–D16), on the
 * shared assistant core. Reads and `preview_evaluator` run as the caller;
 * Evaluators, cases and Brief drafts come back as proposals; a prepared Eval
 * Run comes back for the person to confirm. The Step's Evaluation Brief is
 * sent every turn.
 */
export async function askEvaluationAssistant(
  input: AskEvaluationAssistantInput,
  scope: CallerScope,
): Promise<AskEvaluationAssistantOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'read');
  const apiKey = await requireOpenRouterApiKey(scope, step.namespace);
  const model = input.model ?? EVALUATION_ASSISTANT_DEFAULT_MODEL;

  await recordAssistantPrompt(scope, {
    namespace: step.namespace,
    model,
    messages: input.messages,
    action: 'evaluation_assistant.prompt',
    description: `Evaluation Assistant prompt for step '${step.stepId}' (model: ${model})`,
    basis: 'Evaluation Assistant request (ADR-0023 D14)',
    entityType: 'evaluation_assistant',
    entityId: `${step.workflowName}/${step.stepId}`,
    logTag: 'evaluation-assistant',
  });

  const [brief] = await scope.evaluation.listBriefs(step);
  const result = await runProposalToolLoop({
    model,
    apiKey,
    messages: [
      { role: 'system', content: EVALUATION_ASSISTANT_SYSTEM_PROMPT },
      { role: 'system', content: `You are evaluating step '${step.stepId}' ("${workflowStep.name}") of workflow '${step.workflowName}' v${definition.version} in workspace '${step.namespace}'.` },
      { role: 'system', content: briefMessage(brief ?? null) },
      ...input.messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    proposalTools: EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
    platformTools: EVALUATION_ASSISTANT_PLATFORM_TOOLS,
    executePlatformTool: (toolName, args) => executeEvaluationTool(toolName, args, scope, { step, definition, workflowStep }),
    maxIterations: MAX_TOOL_LOOP_ITERATIONS,
    maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
  });

  return {
    reply: result.reply,
    proposals: result.proposals.map((proposal) => EvaluationAssistantProposalSchema.parse(proposal)),
    preparedEvalRuns: result.platformCalls
      .filter((call) => call.tool === 'prepare_eval_run')
      .flatMap((call) => {
        const prepared = preparedRun(call.result);
        return prepared === null ? [] : [prepared];
      }),
  };
}

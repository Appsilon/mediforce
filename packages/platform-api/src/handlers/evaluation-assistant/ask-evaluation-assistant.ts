import {
  DEFAULT_MODEL,
  DRAFT_DETERMINISTIC_PRESETS_TOOLSET,
  DRAFT_TASK_COMPLETION_EVALUATORS_TOOLSET,
  EVALUATION_ASSISTANT_PLATFORM_TOOLS,
  EVALUATION_ASSISTANT_PROPOSAL_TOOLS,
  EVALUATION_ASSISTANT_TOOLSETS,
  pickTools,
  type EvaluationAssistantPlatformToolName,
  type EvaluationSubject,
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
import { ValidationError } from '../../errors';
import { recordAssistantPrompt, runProposalToolLoop } from '../../assistant-core';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { loadEvaluationSubject, subjectRef, subjectKey, subjectName } from '../evaluation/_lib/evaluation-subject';
import {
  EVALUATION_ASSISTANT_SYSTEM_PROMPTS,
  briefMessage,
  deterministicPresetsDraftMessage,
  taskCompletionEvaluatorsDraftMessage,
  unattendedBudgetMessage,
} from './_lib/system-prompt';
import { executeEvaluationTool, type UnattendedGrant } from './_lib/run-evaluation-tool';
import { reviewEvaluationProposal, type PreviewedCheck } from './_lib/review-proposal';

// Leave room for paged trajectory reads and preview/repair cycles for several checks.
const MAX_TOOL_LOOP_ITERATIONS = 32;
const ASSISTANT_MAX_OUTPUT_TOKENS = 8000;
const TRUNCATED_RESPONSE_NOTICE = 'Your last response was cut off at the output-token limit before it finished, and no tool call in it ran. Work one check at a time: a single tool call per response, for one check, and short prose, then the next check once it is done. If you were writing your final answer, give it again more briefly.';

/** A request's `action` (D14): a dedicated, narrow toolset and a fixed instruction, in place of the subject's ordinary ones. A Step only. */
const DRAFT_ACTIONS = {
  draft_task_completion_evaluators: { toolset: DRAFT_TASK_COMPLETION_EVALUATORS_TOOLSET, message: taskCompletionEvaluatorsDraftMessage },
  draft_deterministic_presets: { toolset: DRAFT_DETERMINISTIC_PRESETS_TOOLSET, message: deterministicPresetsDraftMessage },
} as const;

/** Who the assistant is evaluating: a Step of a workflow version, or an Agent on its own (ADR-0029). */
function subjectContext(step: EvaluationSubject, name: string, version: number): string {
  if (step.kind === 'step') {
    return `You are evaluating step '${step.stepId}' ("${name}") of workflow '${step.workflowName}' v${version} in workspace '${step.namespace}'.`;
  }
  return `You are evaluating ${subjectName(step, false)} ("${name}") on its own, outside any workflow, in workspace '${step.namespace}'. `
    + 'Each Eval Case\'s triggerPayload is its whole input. Its production runs are those of the steps that use it: write cases from what they were given, and a check is first tried in an Eval Run.';
}

function preparedRun(result: unknown): PreparedEvalRun | null {
  if (result === null || typeof result !== 'object' || !('prepared' in result)) return null;
  const prepared = (result as { prepared: { evalRunId: string; budgetUsd: number; estimate: { totalUsd: number | null }; trials: number } }).prepared;
  return { evalRunId: prepared.evalRunId, budgetUsd: prepared.budgetUsd, estimatedUsd: prepared.estimate.totalUsd, trials: prepared.trials };
}

/**
 * One turn with a Step's Evaluation Assistant (ADR-0023 D14–D16), on the
 * shared assistant core, about the Step as `definitionVersion` has it — its
 * runnable version when absent. Reads and `preview_evaluator` run as the caller;
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
  const step = subjectRef(input);
  const draftAction = input.action === undefined ? undefined : DRAFT_ACTIONS[input.action];
  if (draftAction !== undefined && step.kind !== 'step') {
    throw new ValidationError('This action drafts from a workflow step\'s configuration; an agent evaluated on its own has none to draft from');
  }
  const { definition, step: workflowStep, agent } = await loadEvaluationSubject(scope, step, 'read', step.kind === 'step' ? input.definitionVersion : undefined);
  const apiKey = await requireOpenRouterApiKey(scope, step.namespace);
  const model = input.model ?? DEFAULT_MODEL;

  await recordAssistantPrompt(scope, {
    namespace: step.namespace,
    model,
    messages: input.messages,
    ...(input.unattendedBudgetUsd === undefined ? {} : { extraInput: { unattendedBudgetUsd: input.unattendedBudgetUsd } }),
    action: 'evaluation_assistant.prompt',
    description: `Evaluation Assistant prompt for ${subjectName(step, false)} (model: ${model})`,
    basis: 'Evaluation Assistant request (ADR-0023 D14)',
    entityType: 'evaluation_assistant',
    entityId: subjectKey(step),
    logTag: 'evaluation-assistant',
  });

  const [brief] = await scope.evaluation.listBriefs(step);
  const toolset = draftAction?.toolset ?? EVALUATION_ASSISTANT_TOOLSETS[step.kind];
  const unattended: UnattendedGrant | undefined = input.unattendedBudgetUsd === undefined
    ? undefined
    : { remainingUsd: input.unattendedBudgetUsd, started: [] };
  const previewed: PreviewedCheck[] = [];
  const executePlatformTool = async (toolName: EvaluationAssistantPlatformToolName, args: unknown) => {
    const toolResult = await executeEvaluationTool(toolName, args, scope, { step, definition, workflowStep, agent, ...(unattended === undefined ? {} : { unattended }) });
    if (toolName === 'preview_evaluator') {
      previewed.push({ check: (args as { check: EvaluatorCheck }).check, results: (toolResult as PreviewEvaluatorOutput).results });
    }
    return toolResult;
  };
  const result = await runProposalToolLoop({
    model,
    apiKey,
    messages: [
      { role: 'system', content: EVALUATION_ASSISTANT_SYSTEM_PROMPTS[step.kind] },
      { role: 'system', content: subjectContext(step, workflowStep.name, definition.version) },
      { role: 'system', content: briefMessage(brief ?? null, step.kind) },
      { role: 'system', content: unattendedBudgetMessage(input.unattendedBudgetUsd, step.kind) },
      ...(draftAction === undefined ? [] : [{ role: 'system' as const, content: draftAction.message() }]),
      ...input.messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    proposalTools: pickTools(EVALUATION_ASSISTANT_PROPOSAL_TOOLS, toolset.proposals),
    platformTools: pickTools(EVALUATION_ASSISTANT_PLATFORM_TOOLS, toolset.platform),
    executePlatformTool,
    reviewProposal: (toolName, args) => reviewEvaluationProposal(toolName, args, scope, step, previewed),
    maxIterations: MAX_TOOL_LOOP_ITERATIONS,
    maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
    truncatedResponseNotice: TRUNCATED_RESPONSE_NOTICE,
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

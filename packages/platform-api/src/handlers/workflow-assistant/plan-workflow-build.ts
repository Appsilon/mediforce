import {
  PlanWorkflowBuildOutputSchema,
  type PlanWorkflowBuildInput,
  type PlanWorkflowBuildOutput,
} from '../../contract/workflow-assistant';
import { WORKFLOW_ASSISTANT_DEFAULT_MODEL } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { HandlerError } from '../../errors';
import { callOpenRouter } from '../../services/openrouter-client';
import { buildPlanPrompt } from './_lib/plan-prompt';
import { parseModelJson } from './_lib/parse-model-json';

interface PlanScopedInput extends PlanWorkflowBuildInput {
  namespace: string;
}

/** A plan is short by definition; this is generous for four lines and a couple
 *  of questions, and small enough to feel instant next to a build. */
const PLAN_MAX_OUTPUT_TOKENS = 700;

/**
 * The turn before the build: what the assistant intends to do, what it has to
 * ask first, and the phases it expects to work through.
 *
 * Never fails the conversation. The plan is an aid to the build, not the build:
 * when the model returns something unreadable, this returns nothing and the
 * pane goes straight to building, which is exactly what it did before this
 * existed.
 */
export async function planWorkflowBuild(
  input: PlanScopedInput,
  scope: CallerScope,
): Promise<PlanWorkflowBuildOutput> {
  if (typeof input.namespace !== 'string' || input.namespace.length === 0) {
    throw new HandlerError('validation', 'Missing required query parameter: namespace');
  }

  const secrets = await scope.workspaceSecrets.getSecrets(input.namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new HandlerError('validation', 'OPENROUTER_API_KEY not configured in workspace secrets');
  }

  const response = await callOpenRouter({
    model: input.model ?? WORKFLOW_ASSISTANT_DEFAULT_MODEL,
    apiKey,
    maxTokens: PLAN_MAX_OUTPUT_TOKENS,
    messages: [
      { role: 'system', content: buildPlanPrompt() },
      { role: 'system', content: `Current canvas state:\n${JSON.stringify(input.workflowDefinition, null, 2)}` },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ],
  });

  // The schema caps the questions, so an over-long list fails the parse and lands on the empty plan below rather than being trimmed here.
  return parseModelJson(response.content, PlanWorkflowBuildOutputSchema)
    ?? { plan: [], questions: [], phases: [] };
}

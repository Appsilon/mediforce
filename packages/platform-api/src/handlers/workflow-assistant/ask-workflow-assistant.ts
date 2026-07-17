import { z } from 'zod';
import {
  AddStepToolSchema,
  UpdateStepToolSchema,
  RemoveStepToolSchema,
  ListModelsToolSchema,
  WORKFLOW_ASSISTANT_TOOLS,
  WORKFLOW_ASSISTANT_DEFAULT_MODEL,
  toProcessDefinition,
  mergeVerdictTransitions,
  ensureEntryStepFirst,
  validateStepReferences,
  type WorkflowAssistantToolName,
  type WorkflowStep,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import { validateStepGraph } from '@mediforce/workflow-engine';
import type {
  AskWorkflowAssistantInput,
  AskWorkflowAssistantOutput,
  WorkflowAssistantToolCall,
} from '../../contract/workflow-assistant';
import { applyWorkflowAssistantToolCalls } from '../../contract/workflow-assistant-apply';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';
import { HandlerError, ValidationError } from '../../errors';
import { callOpenRouter, type OpenRouterChatMessage, type OpenRouterToolDefinition } from '../../services/openrouter-client';
import { buildWorkflowAssistantSystemPrompt } from './_lib/system-prompt';

interface AskScopedInput extends AskWorkflowAssistantInput {
  namespace: string;
}

const LIST_MODELS_TOOL_NAME = 'list_models';

const MAX_TOOL_LOOP_ITERATIONS = 5;

function buildToolDefinitions(): OpenRouterToolDefinition[] {
  const mutationTools = (
    Object.entries(WORKFLOW_ASSISTANT_TOOLS) as [WorkflowAssistantToolName, typeof AddStepToolSchema][]
  ).map(([name, schema]) => ({
    type: 'function',
    function: { name, parameters: z.toJSONSchema(schema, { io: 'input' }) },
  }));
  return [
    ...mutationTools,
    {
      type: 'function',
      function: {
        name: LIST_MODELS_TOOL_NAME,
        parameters: z.toJSONSchema(ListModelsToolSchema, { io: 'input' }),
      },
    },
  ];
}

async function runListModelsTool(scope: CallerScope): Promise<unknown> {
  const models = await scope.models.list();
  return models
    .filter((m) => m.retiredAt === null)
    .sort((a, b) => (a.pricing.input + a.pricing.output) - (b.pricing.input + b.pricing.output))
    .slice(0, 40)
    .map((m) => ({
      id: m.id,
      name: m.name,
      contextLength: m.contextLength,
      inputPricePerToken: m.pricing.input,
      outputPricePerToken: m.pricing.output,
      supportsTools: m.supportsTools,
      supportsVision: m.supportsVision,
    }));
}

type ParsedMutationCall =
  | { ok: true; toolCall: WorkflowAssistantToolCall }
  | { ok: false; error: string };

function getValueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

function parseMutationToolCall(toolName: string, parsedArguments: unknown): ParsedMutationCall {
  const schema = toolName === 'add_step' ? AddStepToolSchema
    : toolName === 'update_step' ? UpdateStepToolSchema
    : toolName === 'remove_step' ? RemoveStepToolSchema
    : null;
  if (!schema) {
    return { ok: false, error: `Unknown tool '${toolName}'. Valid tools: add_step, update_step, remove_step, list_models.` };
  }
  const result = schema.safeParse(parsedArguments);
  if (!result.success) {
    const issues = result.error.issues.map((i) => {
      const path = i.path.join('.') || '(root)';
      const field = i.path[i.path.length - 1];
      const hint = i.code === 'invalid_type' && i.expected === 'object' && field === 'action'
        ? ` — must be a nested object like { kind: "email", config: { ... } }, not a plain string`
        : '';
      let received = getValueAtPath(parsedArguments, i.path);
      let describedPath = path;
      if (received === undefined && i.path.length > 0) {
        const parentPath = i.path.slice(0, -1);
        const parent = getValueAtPath(parsedArguments, parentPath);
        if (parent !== undefined) {
          received = parent;
          describedPath = parentPath.join('.') || '(root)';
        }
      }
      const gotSuffix = received !== undefined ? ` (you sent for '${describedPath}': ${JSON.stringify(received)})` : '';
      return `${path}: ${i.message}${hint}${gotSuffix}`;
    }).join('; ');
    return { ok: false, error: `Invalid arguments for '${toolName}': ${issues}` };
  }
  return { ok: true, toolCall: { tool: toolName, arguments: result.data } as WorkflowAssistantToolCall };
}

type Transitions = WorkflowDefinition['transitions'];

function validateResultingGraph(
  currentDefinition: { steps: WorkflowStep[]; transitions: Transitions },
  toolCalls: WorkflowAssistantToolCall[],
  namespace: string,
): { valid: true } | { valid: false; errors: string[] } {
  const applied = applyWorkflowAssistantToolCalls(
    currentDefinition.steps,
    currentDefinition.transitions,
    toolCalls,
  );
  const mergedTransitions = mergeVerdictTransitions(applied.steps, applied.transitions);
  const orderedSteps = ensureEntryStepFirst(applied.steps, mergedTransitions);
  const result = validateStepGraph(toProcessDefinition({
    name: 'simulated',
    version: 1,
    namespace,
    visibility: 'private',
    steps: orderedSteps,
    transitions: mergedTransitions,
    triggers: [{ type: 'manual', name: 'start' }],
  }));
  const referenceErrors = validateStepReferences(applied.steps, mergedTransitions)
    .filter((i) => i.severity === 'error')
    .map((i) => i.message);
  const graphErrors = result.valid ? [] : result.errors;
  if (graphErrors.length === 0 && referenceErrors.length === 0) return { valid: true };
  const outcomeErrors = applied.outcomes.flatMap((o) => (o.error ? [o.error] : []));
  return { valid: false, errors: [...graphErrors, ...referenceErrors, ...outcomeErrors] };
}

export async function askWorkflowAssistant(
  input: AskScopedInput,
  scope: CallerScope,
): Promise<AskWorkflowAssistantOutput> {
  if (typeof input.namespace !== 'string' || input.namespace.length === 0) {
    throw new ValidationError('Missing required query parameter: namespace');
  }

  const secrets = await scope.workspaceSecrets.getSecrets(input.namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new HandlerError('validation', 'OPENROUTER_API_KEY not configured in workspace secrets');
  }

  const model = input.model ?? WORKFLOW_ASSISTANT_DEFAULT_MODEL;

  const latestUserPrompt = [...input.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
  try {
    await scope.system.audit.append({
      ...actorFromCaller(scope),
      action: 'workflow_assistant.prompt',
      description: `AI Assistant prompt (model: ${model})`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { prompt: latestUserPrompt, model, messageCount: input.messages.length },
      outputSnapshot: {},
      basis: 'Workflow designer AI Assistant request',
      entityType: 'workflow_assistant',
      entityId: 'workflow-assistant',
      namespace: input.namespace,
    });
  } catch (err) {
    console.error('[workflow-assistant] failed to write prompt audit entry (non-fatal):', err);
  }

  const tools = buildToolDefinitions();
  const messages: OpenRouterChatMessage[] = [
    { role: 'system', content: buildWorkflowAssistantSystemPrompt() },
    {
      role: 'system',
      content: `Current canvas state:\n${JSON.stringify(input.workflowDefinition, null, 2)}`,
    },
    ...input.messages.map((m) => ({ role: m.role, content: m.content }) satisfies OpenRouterChatMessage),
  ];

  let lastErrors: string[] = [];
  const accumulatedToolCalls: WorkflowAssistantToolCall[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_LOOP_ITERATIONS; iteration++) {
    const response = await callOpenRouter({ model, messages, apiKey, tools });

    if (response.finishReason === 'length') {
      throw new HandlerError('validation', 'Assistant response was truncated — try a shorter request.');
    }

    if (response.toolCalls.length === 0) {
      return accumulatedToolCalls.length > 0
        ? { reply: response.content, toolCalls: accumulatedToolCalls }
        : { reply: response.content };
    }

    const resolved = response.toolCalls.map((call) => {
      if (call.function.name === LIST_MODELS_TOOL_NAME) {
        return { call, kind: 'list_models' as const };
      }
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(call.function.arguments);
      } catch {
        return { call, kind: 'error' as const, error: `Malformed JSON arguments for '${call.function.name}'.` };
      }
      const parsed = parseMutationToolCall(call.function.name, parsedArguments);
      return parsed.ok
        ? { call, kind: 'mutation' as const, toolCall: parsed.toolCall }
        : { call, kind: 'error' as const, error: parsed.error };
    });

    if (resolved.every((r) => r.kind === 'mutation')) {
      accumulatedToolCalls.push(...resolved.map((r) => r.toolCall));

      const graphCheck = validateResultingGraph(input.workflowDefinition, accumulatedToolCalls, input.namespace);
      if (graphCheck.valid) {
        if (response.content) {
          return { toolCalls: accumulatedToolCalls, reply: response.content };
        }
        lastErrors = ['The model completed a structurally valid workflow but never wrote a text reply.'];
        console.error(`[workflow-assistant] model finished with a valid graph but empty content (iteration ${String(iteration + 1)}/${String(MAX_TOOL_LOOP_ITERATIONS)}) — requesting the missing reply`);
        messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
        for (const r of resolved) {
          messages.push({ role: 'tool', tool_call_id: r.call.id, content: JSON.stringify({ applied: true }) });
        }
        messages.push({
          role: 'user',
          content: `Those changes were applied and the workflow is complete — but you didn't write a reply. Write one now: one or two sentences in plain language summarizing what you built, exactly as if you were saying it to the user for the first time (see "Conversational style").`,
        });
        continue;
      }

      lastErrors = graphCheck.errors;
      console.error(`[workflow-assistant] graph validation error after tool calls (iteration ${String(iteration + 1)}/${String(MAX_TOOL_LOOP_ITERATIONS)}):`, lastErrors);
      messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
      for (const r of resolved) {
        messages.push({ role: 'tool', tool_call_id: r.call.id, content: JSON.stringify({ applied: true }) });
      }
      messages.push({
        role: 'user',
        content: `Those changes were applied, but the resulting workflow graph is incomplete: ${graphCheck.errors.join('; ')}. Fix this before finishing — use update_step's insertAfterId/insertBeforeId to connect a disconnected step (referencing it by its real id from canvas state, or by the clientId you assigned it earlier in this response if it's a step you just added) or add_step if a step is genuinely missing. Then write a short reply summarizing what you built, same as any other turn.`,
      });
      continue;
    }

    lastErrors = resolved.filter((r) => r.kind === 'error').map((r) => r.error);
    if (lastErrors.length > 0) {
      console.error(`[workflow-assistant] tool call error (iteration ${String(iteration + 1)}/${String(MAX_TOOL_LOOP_ITERATIONS)}):`, lastErrors);
    }
    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
    for (const r of resolved) {
      if (r.kind === 'list_models') {
        const result = await runListModelsTool(scope);
        messages.push({ role: 'tool', tool_call_id: r.call.id, content: JSON.stringify(result) });
      } else if (r.kind === 'error') {
        messages.push({ role: 'tool', tool_call_id: r.call.id, content: JSON.stringify({ error: r.error }) });
      } else {
        messages.push({
          role: 'tool',
          tool_call_id: r.call.id,
          content: JSON.stringify({ deferred: true, reason: 'Another call in this turn needs fixing first — retry this one after.' }),
        });
      }
    }
  }

  throw new HandlerError(
    'internal',
    lastErrors.length > 0
      ? `Assistant did not finish after several rounds of tool use. Last error: ${lastErrors.join('; ')}`
      : 'Assistant did not finish after several rounds of tool use — try rephrasing your request.',
  );
}

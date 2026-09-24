import type { z } from 'zod';
import { HandlerError } from '../errors';
import { callOpenRouter, type OpenRouterChatMessage } from '../services/openrouter-client';
import { toolDefinitions } from './tool-definitions';
import { parseToolArguments } from './tool-arguments';
import { runPlatformTool } from './platform-tools';

export interface ProposalToolLoopConfig<TPlatform extends string> {
  readonly model: string;
  readonly apiKey: string;
  /** System prompt(s) and the conversation so far. Extended in place with this turn's tool traffic. */
  readonly messages: OpenRouterChatMessage[];
  /** Tools whose calls come back to the person as proposals; never run here. */
  readonly proposalTools: Readonly<Record<string, z.ZodType>>;
  /** Tools run here, as the caller; their results go back to the model. */
  readonly platformTools: Readonly<Record<TPlatform, z.ZodType>>;
  readonly executePlatformTool: (toolName: TPlatform, args: unknown) => Promise<unknown>;
  readonly maxIterations: number;
  readonly maxTokens: number;
}

export interface ProposalToolLoopResult {
  readonly reply: string;
  /** Validated proposal calls, in the order the model made them. */
  readonly proposals: ReadonlyArray<{ readonly tool: string; readonly arguments: unknown }>;
  /** Every platform call and what it returned, for the caller to act on (e.g. a prepared run to confirm). */
  readonly platformCalls: ReadonlyArray<{ readonly tool: string; readonly result: unknown }>;
}

const PROPOSED = {
  proposed: true,
  note: 'Shown to the person as a card to accept, edit or reject. It does not exist until they accept it.',
};

/**
 * The tool loop of an assistant whose changes are proposals (ADR-0023 D14):
 * call the model; run platform tools as the caller and feed their results
 * back; validate proposal calls and collect them for the person; stop at the
 * first turn with no tool calls. A malformed or unknown call is answered as a
 * tool error, so the model can correct itself within the same request.
 */
export async function runProposalToolLoop<TPlatform extends string>(
  config: ProposalToolLoopConfig<TPlatform>,
): Promise<ProposalToolLoopResult> {
  const tools = toolDefinitions({ ...config.proposalTools, ...config.platformTools });
  const proposals: Array<{ tool: string; arguments: unknown }> = [];
  const platformCalls: Array<{ tool: string; result: unknown }> = [];
  const messages = config.messages;

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    const response = await callOpenRouter({
      model: config.model,
      apiKey: config.apiKey,
      messages,
      tools,
      maxTokens: config.maxTokens,
    });
    if (response.toolCalls.length === 0) {
      if (response.finishReason === 'length') {
        throw new HandlerError('validation', 'Assistant response was truncated — try a shorter request.');
      }
      return { reply: response.content, proposals, platformCalls };
    }

    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
    for (const call of response.toolCalls) {
      const toolName = call.function.name;
      let result: unknown;
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(call.function.arguments || '{}');
      } catch {
        parsedArguments = undefined;
      }
      if (parsedArguments === undefined) {
        result = { error: `Malformed JSON arguments for '${toolName}'.` };
      } else if (toolName in config.proposalTools) {
        const parsed = parseToolArguments(toolName, config.proposalTools[toolName]!, parsedArguments);
        if (parsed.ok) {
          proposals.push({ tool: toolName, arguments: parsed.data });
          result = PROPOSED;
        } else {
          result = { error: parsed.error };
        }
      } else if (toolName in config.platformTools) {
        result = await runPlatformTool({
          toolName,
          rawArguments: parsedArguments,
          tools: config.platformTools,
          execute: config.executePlatformTool,
        });
        platformCalls.push({ tool: toolName, result });
      } else {
        const valid = [...Object.keys(config.proposalTools), ...Object.keys(config.platformTools)].join(', ');
        result = { error: `Unknown tool '${toolName}'. Valid tools: ${valid}.` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }

  throw new HandlerError('internal', 'The assistant did not finish after several rounds of tool use — try a narrower request.');
}

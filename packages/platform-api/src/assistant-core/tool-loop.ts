import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import { callOpenRouter, OpenRouterNetworkError, type OpenRouterChatMessage } from '../services/openrouter-client';
import { toolDefinitions } from './tool-definitions';
import { parseToolArguments } from './tool-arguments';
import { runPlatformTool } from './platform-tools';

/**
 * What checking one proposal against the platform found: it stands, with
 * anything the person should see beside it; or it does not, and the model is
 * told why so it can correct it within the same request.
 */
export type ProposalReview =
  | { readonly ok: true; readonly evidence?: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: string };

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
  /** Checks a validated proposal before the person sees it; without it every valid proposal stands. */
  readonly reviewProposal?: (toolName: string, args: unknown) => Promise<ProposalReview>;
  readonly maxIterations: number;
  readonly maxTokens: number;
  /** Told when a model round starts and as each tool call runs, so a person can watch the turn progress. */
  readonly onProgress?: (event: ToolLoopProgress) => void;
}

export type ToolLoopProgress =
  | { readonly type: 'thinking'; readonly round: number }
  | {
    readonly type: 'tool';
    readonly round: number;
    readonly callId: string;
    readonly tool: string;
    readonly status: 'running' | 'done' | 'failed';
    readonly error?: string;
  };

export interface ProposalToolLoopResult {
  readonly reply: string;
  /** Validated proposal calls, in the order the model made them, with what their review found. */
  readonly proposals: ReadonlyArray<{
    readonly tool: string;
    readonly arguments: unknown;
    readonly evidence?: Readonly<Record<string, unknown>>;
  }>;
  /** Every platform call and what it returned, for the caller to act on (e.g. a prepared run to confirm). */
  readonly platformCalls: ReadonlyArray<{ readonly tool: string; readonly result: unknown }>;
}

const PROPOSED = {
  proposed: true,
  note: 'Shown to the person as a card to accept, edit or reject. It does not exist until they accept it.',
};

const ALREADY_PROPOSED = {
  proposed: true,
  duplicate: true,
  note: 'You already proposed exactly this in this turn; the person sees it once. Do not propose it again.',
};

const MAX_REPEATED_VALIDATION_ROUNDS = 3;
// ~15k tokens. Keeps one tool result (a check comment, a trajectory page) from
// pushing the conversation past the provider's request-size or context limit.
const MAX_TOOL_RESULT_CHARS = 60_000;

function capToolResult(content: string): string {
  return `${content.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated: this tool result was ${String(content.length)} characters; only the first ${String(MAX_TOOL_RESULT_CHARS)} are shown. Ask for less — a smaller get_trajectory limit, or a check whose comment is a short summary rather than dumped data.]`;
}

/** A review that throws refuses the proposal with its message, as a platform tool's failure is answered. */
async function reviewProposal(
  review: ProposalToolLoopConfig<string>['reviewProposal'],
  toolName: string,
  args: unknown,
): Promise<ProposalReview> {
  if (review === undefined) return { ok: true };
  try {
    return await review(toolName, args);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The platform refused that proposal.' };
  }
}

/**
 * The tool loop of an assistant whose changes are proposals (ADR-0023 D14):
 * call the model; run platform tools as the caller and feed their results
 * back; validate proposal calls, review them against the platform, and
 * collect them for the person; stop at the first turn with no tool calls. A
 * malformed, unknown or refused call is answered as a tool error, so the
 * model can correct itself within the same request.
 */
export async function runProposalToolLoop<TPlatform extends string>(
  config: ProposalToolLoopConfig<TPlatform>,
): Promise<ProposalToolLoopResult> {
  const tools = toolDefinitions({ ...config.proposalTools, ...config.platformTools });
  const proposals: Array<{ tool: string; arguments: unknown; evidence?: Readonly<Record<string, unknown>> }> = [];
  const platformCalls: Array<{ tool: string; result: unknown }> = [];
  const proposalKeys = new Set<string>();
  const messages = config.messages;
  const requestId = randomUUID();
  const report = config.onProgress ?? (() => {});
  let validationStreaks = new Map<string, number>();

  const finishPartial = async (reason: string): Promise<ProposalToolLoopResult> => {
    const notice = `${reason} Any completed proposals and prepared runs are included below; unfinished work can be continued in another message.`;
    let reply = notice;
    try {
      const summary = await callOpenRouter({
        model: config.model,
        apiKey: config.apiKey,
        maxTokens: Math.min(config.maxTokens, 2000),
        messages: [...messages, {
          role: 'user',
          content: `${reason} Stop using tools. Briefly summarize the verified findings, completed proposals and anything still unfinished. Include the relevant run IDs, files, preview outcomes and next trajectory offset so a follow-up can continue from this summary. Do not claim the request is complete if work remains. Proposals still require the person's acceptance.`,
        }],
      });
      if (summary.finishReason !== 'length' && summary.toolCalls.length === 0 && summary.content.trim() !== '') {
        reply = `${notice}\n\n${summary.content}`;
      }
    } catch {
      console.warn('[assistant-tool-loop] summary failed', { requestId, model: config.model });
    }
    return { reply, proposals, platformCalls };
  };

  for (let iteration = 0; iteration < config.maxIterations; iteration++) {
    let response: Awaited<ReturnType<typeof callOpenRouter>>;
    report({ type: 'thinking', round: iteration + 1 });
    try {
      response = await callOpenRouter({
        model: config.model,
        apiKey: config.apiKey,
        messages,
        tools,
        maxTokens: config.maxTokens,
      });
    } catch (error) {
      if (error instanceof OpenRouterNetworkError) {
        console.warn('[assistant-tool-loop] model connection failed', { requestId, round: iteration + 1, error: error.message });
        return finishPartial('The connection to the model was interrupted.');
      }
      throw error;
    }
    console.info('[assistant-tool-loop] round', {
      requestId,
      model: config.model,
      round: iteration + 1,
      finishReason: response.finishReason,
      ...response.usage,
      tools: response.toolCalls.map((call) => call.function.name),
    });
    if (response.toolCalls.length === 0) {
      if (response.finishReason === 'length') {
        return finishPartial('The assistant response was truncated at its output-token limit.');
      }
      return { reply: response.content, proposals, platformCalls };
    }

    messages.push({ role: 'assistant', content: response.content, tool_calls: response.toolCalls });
    const validationFailures = new Map<string, { tool: string; error: string }>();
    let madeProgress = false;
    for (const call of response.toolCalls) {
      const toolName = call.function.name;
      const progress = { type: 'tool', round: iteration + 1, callId: call.id, tool: toolName } as const;
      report({ ...progress, status: 'running' });
      let result: unknown;
      let parsedArguments: unknown;
      try {
        parsedArguments = JSON.parse(call.function.arguments || '{}');
      } catch {
        parsedArguments = undefined;
      }
      if (parsedArguments === undefined) {
        result = { error: response.finishReason === 'length'
          ? `Arguments for '${toolName}' were truncated at the output-token limit. Retry with a shorter check, one proposal at a time. Do not repeat successful calls.`
          : `Malformed JSON arguments for '${toolName}'.` };
      } else if (Object.hasOwn(config.proposalTools, toolName)) {
        const parsed = parseToolArguments(toolName, config.proposalTools[toolName]!, parsedArguments);
        if (parsed.ok === false) {
          result = { error: parsed.error, validationError: parsed.validationError, expectedArguments: parsed.expectedArguments };
        } else if (proposalKeys.has(JSON.stringify([toolName, parsed.data]))) {
          result = ALREADY_PROPOSED;
        } else {
          const review = await reviewProposal(config.reviewProposal, toolName, parsed.data);
          if (review.ok) {
            proposalKeys.add(JSON.stringify([toolName, parsed.data]));
            proposals.push({ tool: toolName, arguments: parsed.data, ...(review.evidence === undefined ? {} : { evidence: review.evidence }) });
            result = { ...PROPOSED, ...review.evidence };
          } else {
            result = { error: review.error };
          }
        }
      } else if (Object.hasOwn(config.platformTools, toolName)) {
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
      let content = JSON.stringify(result);
      if (content.length > MAX_TOOL_RESULT_CHARS) {
        console.warn('[assistant-tool-loop] tool result truncated', { requestId, round: iteration + 1, tool: toolName, chars: content.length });
        content = capToolResult(content);
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content });
      if (result !== null && typeof result === 'object' && 'error' in result) {
        const validationError = 'validationError' in result && typeof result.validationError === 'string' ? result.validationError : undefined;
        if (validationError !== undefined) {
          validationFailures.set(JSON.stringify([toolName, validationError]), { tool: toolName, error: validationError });
        }
        console.warn('[assistant-tool-loop] tool error', { requestId, round: iteration + 1, tool: toolName, error: validationError ?? result.error, detail: typeof result.error === 'string' ? result.error.slice(0, 600) : undefined });
        report({ ...progress, status: 'failed', error: validationError ?? String(result.error) });
      } else {
        madeProgress = true;
        report({ ...progress, status: 'done' });
      }
    }
    if (madeProgress === true) {
      validationStreaks.clear();
    } else {
      const nextStreaks = new Map<string, number>();
      for (const [signature, failure] of validationFailures) {
        const count = (validationStreaks.get(signature) ?? 0) + 1;
        nextStreaks.set(signature, count);
        if (count >= MAX_REPEATED_VALIDATION_ROUNDS) {
          console.warn('[assistant-tool-loop] repeated validation failure', { requestId, round: iteration + 1, ...failure, count });
          return finishPartial(`The assistant stopped after ${count} consecutive rounds with the same invalid arguments for '${failure.tool}': ${failure.error}. The invalid calls were not executed.`);
        }
      }
      validationStreaks = nextStreaks;
    }
  }

  return finishPartial(`The assistant reached its ${String(config.maxIterations)}-round tool-use limit.`);
}

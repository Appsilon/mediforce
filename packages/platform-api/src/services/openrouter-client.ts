/**
 * OpenRouter chat completions client (non-streaming).
 *
 * Single seam for OpenRouter HTTP. Callers stay decoupled from header shape,
 * temperature defaults, and response parsing. Future consolidation with
 * `agent-runtime/src/runner/llm-client.ts` and
 * `handlers/system/get-openrouter-credits.ts` tracked in #529.
 */

// Base URL is overridable via OPENROUTER_BASE_URL so tests (and self-hosted
// proxies) can point at a mock; defaults to the real OpenRouter endpoint so a
// normal deploy needs no config.
const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
const OPENROUTER_CHAT_COMPLETIONS_URL = `${OPENROUTER_BASE_URL.replace(/\/$/, '')}/chat/completions`;

export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface OpenRouterChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface OpenRouterToolDefinition {
  type: string;
  function: Record<string, unknown>;
}

export interface OpenRouterResponse {
  content: string;
  toolCalls: OpenRouterToolCall[];
  /**
   * OpenRouter/Anthropic completion stop reason. `'length'` means the model
   * hit `max_tokens` and the output (including any tool-call arguments) is
   * truncated — callers building large artifacts must treat this as an error.
   */
  finishReason: string | null;
  /** Token counts as OpenRouter reports them; zero when the response carries none. */
  usage: { promptTokens: number; completionTokens: number };
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  apiKey: string;
  tools?: OpenRouterToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

/** The connection to OpenRouter dropped or never completed (no HTTP response), even after one retry. */
export class OpenRouterNetworkError extends Error {
  constructor(cause: unknown) {
    super(`Could not reach the model provider (${cause instanceof Error ? cause.message : String(cause)}). Check your connection and try again in a moment.`, { cause });
    this.name = 'OpenRouterNetworkError';
  }
}

/** What a failing HTTP status means for the person, and what they can do about it. */
function describeModelApiFailure(status: number): string {
  if (status === 401 || status === 403) return 'OpenRouter rejected the API key. Check that OPENROUTER_API_KEY in the workspace secrets is valid and not revoked.';
  if (status === 402) return 'The OpenRouter account is out of credits. Top it up, then try again.';
  if (status === 404) return 'OpenRouter does not offer the selected model. Pick another model in the assistant settings.';
  if (status === 408 || status === 504) return 'The model took too long to answer. Try again, or pick a faster model in the assistant settings.';
  if (status === 429) return 'OpenRouter is rate-limiting requests. Wait a minute, then try again.';
  if (status >= 500) return 'OpenRouter is having trouble right now. Try again in a moment, or pick another model in the assistant settings.';
  return 'OpenRouter rejected the request. Try again, or pick another model in the assistant settings.';
}

async function postChatCompletion(request: RequestInit): Promise<Response> {
  try {
    return await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, request);
  } catch {
    try {
      return await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, request);
    } catch (retryError) {
      throw new OpenRouterNetworkError(retryError);
    }
  }
}

export async function callOpenRouter(req: OpenRouterRequest): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };
  if (req.tools !== undefined) body.tools = req.tools;

  const response = await postChatCompletion({
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.warn('[openrouter] model API error', { status: response.status, model: req.model, body: errorText.slice(0, 600) });
    throw new Error(`Model API error ${String(response.status)}: ${describeModelApiFailure(response.status)}`);
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: OpenRouterToolCall[];
      };
      finish_reason?: string | null;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? null,
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
    },
  };
}

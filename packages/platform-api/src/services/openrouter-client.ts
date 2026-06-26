/**
 * OpenRouter chat completions client (non-streaming).
 *
 * Single seam for OpenRouter HTTP. Callers stay decoupled from header shape,
 * temperature defaults, and response parsing. Future consolidation with
 * `agent-runtime/src/runner/llm-client.ts` and
 * `handlers/system/get-openrouter-credits.ts` tracked in #529.
 */

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

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
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterChatMessage[];
  apiKey: string;
  tools?: OpenRouterToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export async function callOpenRouter(req: OpenRouterRequest): Promise<OpenRouterResponse> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0.7,
    max_tokens: req.maxTokens ?? 4096,
  };
  if (req.tools !== undefined) body.tools = req.tools;

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Model API error ${response.status}: ${errorText}`);
  }

  const data = (await response.json()) as {
    choices: Array<{
      message: {
        content?: string | null;
        tool_calls?: OpenRouterToolCall[];
      };
      finish_reason?: string | null;
    }>;
  };

  const choice = data.choices?.[0];
  return {
    content: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    finishReason: choice?.finish_reason ?? null,
  };
}

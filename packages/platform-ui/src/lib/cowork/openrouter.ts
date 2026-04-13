import type { ChatMessage } from './build-messages.js';

/**
 * Tool call from an OpenRouter / OpenAI chat completion response.
 */
export interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/**
 * Parsed response from a non-streaming OpenRouter chat completion.
 */
export interface OpenRouterResponse {
  content: string;
  toolCalls: OpenRouterToolCall[];
}

/**
 * Call OpenRouter chat completions API (non-streaming).
 * Extracts text content and tool calls from the response.
 */
export async function callOpenRouter(
  model: string,
  messages: ChatMessage[],
  tools: Array<{ type: string; function: Record<string, unknown> }>,
): Promise<OpenRouterResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.DOCKER_OPENROUTER_API_KEY ?? '';

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      tools,
      temperature: 0.7,
      max_tokens: 4096,
    }),
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
    }>;
  };

  const choice = data.choices?.[0]?.message;

  return {
    content: choice?.content ?? '',
    toolCalls: choice?.tool_calls ?? [],
  };
}

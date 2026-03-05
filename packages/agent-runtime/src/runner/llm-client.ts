import type { LlmMessage, LlmResponse } from '../interfaces/agent-plugin.js';

// Re-export the interface defined in interfaces/ for barrel convenience
export type { LlmClient, LlmMessage, LlmResponse } from '../interfaces/agent-plugin.js';

// OpenRouterLlmClient: wraps the OpenRouter API for LLM access.
// Platform provides this to agents — agents never call OpenRouter directly.
export class OpenRouterLlmClient {
  constructor(
    private readonly apiKey: string,
    private readonly defaultModel: string = 'anthropic/claude-sonnet-4',
  ) {}

  async complete(messages: LlmMessage[], model?: string): Promise<LlmResponse> {
    const selectedModel = model ?? this.defaultModel;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as {
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    return {
      content: data.choices[0].message.content,
      model: data.model,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
      },
    };
  }
}

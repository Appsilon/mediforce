import type { LlmMessage, LlmResponse } from '../interfaces/step-executor-plugin';
import {
  annotateOpenRouterLlmSpan,
  type OpenTelemetryTracingOptions,
  withOpenRouterLlmSpan,
} from './tracing';

// Re-export the interface defined in interfaces/ for barrel convenience
export type { LlmClient, LlmMessage, LlmResponse } from '../interfaces/step-executor-plugin';

// OpenRouterLlmClient: wraps the OpenRouter API for LLM access.
// Platform provides this to agents — agents never call OpenRouter directly.
// OPENROUTER_BASE_URL points it at a mock or a proxy, as it does
// platform-api's OpenRouter seam; unset, it is OpenRouter itself.
export class OpenRouterLlmClient {
  private readonly chatCompletionsUrl =
    `${(process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')}/chat/completions`;

  constructor(
    private readonly apiKey: string,
    private readonly tracingOptions: OpenTelemetryTracingOptions = {},
  ) {}

  async complete(messages: LlmMessage[], model: string): Promise<LlmResponse> {
    return withOpenRouterLlmSpan(
      {
        messages,
        selectedModel: model,
        captureContent: this.tracingOptions.captureContent === true,
      },
      async (span) => {
        const response = await fetch(this.chatCompletionsUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0,
            max_tokens: 16_000,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as {
          model?: string;
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const answeredBy = data.model ?? model;
        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;

        annotateOpenRouterLlmSpan(
          span,
          {
            model: answeredBy,
            promptTokens,
            completionTokens,
            content: data.choices[0].message.content,
          },
          this.tracingOptions.captureContent === true,
        );

        return {
          content: data.choices[0].message.content,
          model: answeredBy,
          usage: { promptTokens, completionTokens },
        };
      },
    );
  }
}

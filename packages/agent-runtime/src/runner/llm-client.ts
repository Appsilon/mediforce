import type { LlmCallOptions, LlmMessage, LlmResponse } from '../interfaces/step-executor-plugin';
import {
  annotateOpenRouterLlmSpan,
  type OpenTelemetryTracingOptions,
  withOpenRouterLlmSpan,
} from './tracing';

// Re-export the interface defined in interfaces/ for barrel convenience
export type { LlmCallOptions, LlmClient, LlmMessage, LlmResponse } from '../interfaces/step-executor-plugin';

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

  async complete(messages: LlmMessage[], model: string, options: LlmCallOptions = {}): Promise<LlmResponse> {
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
            temperature: options.temperature ?? 0.7,
            max_tokens: 16_000,
            ...(options.answerTool === undefined ? {} : {
              tools: [{ type: 'function', function: options.answerTool }],
              tool_choice: { type: 'function', function: { name: options.answerTool.name } },
            }),
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
        }

        const data = await response.json() as {
          model?: string;
          choices: Array<{
            message: { content: string | null; tool_calls?: Array<{ function: { arguments: string } }> };
            finish_reason?: string | null;
          }>;
          usage?: { prompt_tokens: number; completion_tokens: number };
        };
        const choice = data.choices[0];
        const content = (options.answerTool === undefined ? undefined : choice.message.tool_calls?.[0]?.function.arguments)
          ?? choice.message.content ?? '';
        const answeredBy = data.model ?? model;
        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;

        annotateOpenRouterLlmSpan(
          span,
          {
            model: answeredBy,
            promptTokens,
            completionTokens,
            content,
          },
          this.tracingOptions.captureContent === true,
        );

        return {
          content,
          model: answeredBy,
          usage: { promptTokens, completionTokens },
          stopReason: choice.finish_reason ?? null,
        };
      },
    );
  }
}

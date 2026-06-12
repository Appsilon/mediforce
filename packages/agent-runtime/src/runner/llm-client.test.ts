import { afterEach, describe, expect, it, vi } from 'vitest';
import { trace } from '@opentelemetry/api';
import { OpenRouterLlmClient } from './llm-client';
import { RecordingTracerProvider } from '../testing/index';

describe('OpenRouterLlmClient tracing', () => {
  afterEach(() => {
    trace.disable();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('emits an OpenTelemetry span with model and token attributes by default, without prompt content', async () => {
    const tracerProvider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'anthropic/claude-sonnet-4',
          choices: [{ message: { content: 'Looks good.' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 },
        }),
      }),
    );

    const client = new OpenRouterLlmClient('test-api-key');

    const response = await client.complete([
      { role: 'system', content: 'You are a reviewer.' },
      { role: 'user', content: 'Review this output.' },
    ]);

    expect(response.usage).toEqual({ promptTokens: 11, completionTokens: 7 });

    const span = tracerProvider.spans[0];
    expect(span.name).toBe('openrouter.chat.completion');
    expect(span.attributes['gen_ai.request.model']).toBe('anthropic/claude-sonnet-4');
    expect(span.attributes['gen_ai.response.model']).toBe('anthropic/claude-sonnet-4');
    expect(span.attributes['gen_ai.usage.input_tokens']).toBe(11);
    expect(span.attributes['gen_ai.usage.output_tokens']).toBe(7);
    expect(span.attributes['mediforce.llm.provider']).toBe('openrouter');
    expect(span.attributes['gen_ai.prompt.0.content']).toBeUndefined();
    expect(span.attributes['gen_ai.completion.0.content']).toBeUndefined();
    expect(span.ended).toBe(true);
  });

  it('captures prompt and completion content only when content capture is enabled', async () => {
    const tracerProvider = new RecordingTracerProvider();
    trace.setGlobalTracerProvider(tracerProvider);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'anthropic/claude-sonnet-4',
          choices: [{ message: { content: 'Accepted.' } }],
          usage: { prompt_tokens: 5, completion_tokens: 3 },
        }),
      }),
    );

    const client = new OpenRouterLlmClient('test-api-key', 'anthropic/claude-sonnet-4', {
      captureContent: true,
    });

    await client.complete([{ role: 'user', content: 'Summarize this.' }]);

    const span = tracerProvider.spans[0];
    expect(span.attributes['gen_ai.prompt.0.role']).toBe('user');
    expect(span.attributes['gen_ai.prompt.0.content']).toBe('Summarize this.');
    expect(span.attributes['gen_ai.completion.0.role']).toBe('assistant');
    expect(span.attributes['gen_ai.completion.0.content']).toBe('Accepted.');
  });
});

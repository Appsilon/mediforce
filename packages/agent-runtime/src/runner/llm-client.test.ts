import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Attributes,
  Context,
  Link,
  Span,
  SpanOptions,
  SpanStatus,
  TimeInput,
  Tracer,
  TracerProvider,
} from '@opentelemetry/api';
import { trace } from '@opentelemetry/api';
import { OpenRouterLlmClient } from './llm-client';

type SpanCallback<T> = (span: Span) => T;

class RecordingSpan {
  public readonly attributes: Record<string, string | number | boolean> = {};
  public readonly exceptions: unknown[] = [];
  public ended = false;
  public status: SpanStatus | null = null;

  constructor(
    public name: string,
    public readonly parentName: string | null,
    attributes?: Attributes,
  ) {
    Object.assign(this.attributes, attributes);
  }

  spanContext() {
    return {
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      traceFlags: 1,
    };
  }

  setAttribute(key: string, value: string | number | boolean) {
    this.attributes[key] = value;
    return this as unknown as Span;
  }

  setAttributes(attributes: Attributes) {
    for (const [key, value] of Object.entries(attributes)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        this.attributes[key] = value;
      }
    }
    return this as unknown as Span;
  }

  addEvent(): this {
    return this;
  }

  addLink(_link: Link): this {
    return this;
  }

  addLinks(_links: Link[]): this {
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.status = status;
    return this;
  }

  updateName(name: string): this {
    this.name = name;
    return this;
  }

  end(_endTime?: TimeInput): void {
    this.ended = true;
  }

  isRecording(): boolean {
    return true;
  }

  recordException(exception: unknown): void {
    this.exceptions.push(exception);
  }
}

class RecordingTracer implements Tracer {
  constructor(
    private readonly spans: RecordingSpan[],
    private readonly spanStack: RecordingSpan[],
  ) {}

  startSpan(name: string, options?: SpanOptions): Span {
    const span = new RecordingSpan(name, this.spanStack.at(-1)?.name ?? null, options?.attributes);
    this.spans.push(span);
    return span as unknown as Span;
  }

  startActiveSpan<F extends (span: Span) => ReturnType<F>>(name: string, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(name: string, options: SpanOptions, fn: F): ReturnType<F>;
  startActiveSpan<F extends (span: Span) => ReturnType<F>>(
    name: string,
    _options: SpanOptions,
    _context: Context,
    fn: F,
  ): ReturnType<F>;
  startActiveSpan<T>(
    name: string,
    optionsOrFn: SpanOptions | SpanCallback<T>,
    contextOrFn?: Context | SpanCallback<T>,
    fnMaybe?: SpanCallback<T>,
  ): T {
    const callback =
      typeof optionsOrFn === 'function'
        ? optionsOrFn
        : typeof contextOrFn === 'function'
          ? contextOrFn
          : fnMaybe;

    if (callback === undefined) {
      throw new Error('Missing span callback');
    }

    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
    const span = new RecordingSpan(name, this.spanStack.at(-1)?.name ?? null, options?.attributes);
    this.spans.push(span);
    this.spanStack.push(span);

    try {
      const result = callback(span as unknown as Span);
      if (result instanceof Promise) {
        return result.finally(() => {
          span.end();
          this.spanStack.pop();
        }) as T;
      }

      span.end();
      this.spanStack.pop();
      return result;
    } catch (error) {
      span.end();
      this.spanStack.pop();
      throw error;
    }
  }
}

class RecordingTracerProvider implements TracerProvider {
  public readonly spans: RecordingSpan[] = [];
  private readonly spanStack: RecordingSpan[] = [];

  getTracer(): Tracer {
    return new RecordingTracer(this.spans, this.spanStack);
  }
}

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

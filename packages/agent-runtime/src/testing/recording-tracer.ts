// Test double for OpenTelemetry tracing: records spans in memory so tests can
// assert on span names, attributes, status, and parent relationships without
// pulling in the OTel SDK. Register with:
//   trace.setGlobalTracerProvider(new RecordingTracerProvider())
// and call trace.disable() in afterEach.
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

type SpanCallback<T> = (span: Span) => T;

export class RecordingSpan {
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
    const span = new RecordingSpan(name, this.parentNameFor(options), options?.attributes);
    this.spans.push(span);
    return span as unknown as Span;
  }

  private parentNameFor(options?: SpanOptions): string | null {
    if (options?.root === true) {
      return null;
    }
    return this.spanStack.at(-1)?.name ?? null;
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
      typeof optionsOrFn === 'function' ? optionsOrFn : typeof contextOrFn === 'function' ? contextOrFn : fnMaybe;

    if (callback === undefined) {
      throw new Error('Missing span callback');
    }

    const options = typeof optionsOrFn === 'function' ? undefined : optionsOrFn;
    const span = new RecordingSpan(name, this.parentNameFor(options), options?.attributes);
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

export class RecordingTracerProvider implements TracerProvider {
  public readonly spans: RecordingSpan[] = [];
  private readonly spanStack: RecordingSpan[] = [];

  getTracer(): Tracer {
    return new RecordingTracer(this.spans, this.spanStack);
  }
}

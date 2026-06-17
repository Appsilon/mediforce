// Node-only: OTel SDK bootstrap (ADR-0007 layer 1). Dynamic-imported from
// instrumentation.ts only inside the NEXT_RUNTIME === 'nodejs' branch, same
// pattern as instrumentation-node.ts — keeps the SDK out of the Edge module
// graph (type-only imports below are erased at compile time). The
// agent-runtime spans (mediforce.agent.run, openrouter.chat.completion) are
// emitted via the global @opentelemetry/api tracer; without this provider
// registration they are no-ops.
import type { Context } from '@opentelemetry/api';
import type { ReadableSpan, Span, SpanProcessor } from '@opentelemetry/sdk-trace-node';

// Registering a global tracer provider also activates Next.js's built-in
// instrumentation, which emits a span tree for every HTTP request — at dev
// polling rates that floods the trace store and buries agent runs. Export
// only our own instrumentation scopes unless explicitly asked for everything.
const MEDIFORCE_SCOPE_PREFIX = '@mediforce/';

class MediforceScopeSpanProcessor implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (span.instrumentationScope.name.startsWith(MEDIFORCE_SCOPE_PREFIX)) {
      this.inner.onEnd(span);
    }
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

export async function initOpenTelemetry(): Promise<void> {
  // Opt-in: no endpoint, no tracing. Phoenix dev default:
  // OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:6006
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT === undefined
    || process.env.OTEL_EXPORTER_OTLP_ENDPOINT === '') {
    return;
  }

  const { NodeTracerProvider, BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');

  // OTLPTraceExporter appends /v1/traces to OTEL_EXPORTER_OTLP_ENDPOINT.
  const exporter = new OTLPTraceExporter();

  const batchProcessor = new BatchSpanProcessor(exporter);
  const exportAllScopes = process.env.MEDIFORCE_OTEL_EXPORT_ALL_SPANS === 'true';

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'mediforce-platform',
    }),
    spanProcessors: [
      exportAllScopes ? batchProcessor : new MediforceScopeSpanProcessor(batchProcessor),
    ],
  });

  provider.register();

  console.log(
    `[otel] trace export enabled → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`,
  );
}

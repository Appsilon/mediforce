// Node-only: OTel SDK bootstrap (ADR-0007 layer 1). Dynamic-imported from
// instrumentation.ts only inside the NEXT_RUNTIME === 'nodejs' branch, same
// pattern as instrumentation-node.ts — keeps the SDK out of the Edge module
// graph. The agent-runtime spans (mediforce.agent.run,
// openrouter.chat.completion) are emitted via the global @opentelemetry/api
// tracer; without this provider registration they are no-ops.
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

  const provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'mediforce-platform',
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });

  provider.register();

  console.log(
    `[otel] trace export enabled → ${process.env.OTEL_EXPORTER_OTLP_ENDPOINT}`,
  );
}

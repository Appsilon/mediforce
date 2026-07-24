export async function register(): Promise<void> {
  // Only validate on the server runtime (not edge, not build-time).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // validateEnv lives in a node-only module (it calls process.exit) so the
    // Edge runtime build never parses it. See instrumentation-node.ts.
    const { validateEnv } = await import('./instrumentation-node');
    validateEnv();

    // OTel trace export (ADR-0007) — no-op unless OTEL_EXPORTER_OTLP_ENDPOINT
    // is set. See instrumentation-otel.ts.
    const { initOpenTelemetry } = await import('./instrumentation-otel');
    await initOpenTelemetry();

    // Deploy fast-path (ADR-0010 §4): mark in-flight step executions
    // `interrupted` on SIGTERM, and immediately re-kick any run left
    // interrupted by the previous process so it retries in seconds instead of
    // waiting out the timeout. The boot sweep is scheduled (not awaited) so it
    // fires once the HTTP server is listening. See graceful-shutdown.ts.
    const { registerGracefulShutdown, scheduleBootRekickSweep } = await import('./lib/graceful-shutdown');
    registerGracefulShutdown();
    scheduleBootRekickSweep();
  }
}

// ADR-0001 — Postgres migrations are NOT applied here. They run in a
// separate `migrate` compose service (init container, see
// docker-compose.prod.yml) before `platform-ui` starts, gated by
// `depends_on: { migrate: { condition: service_completed_successfully } }`.
// Local dev runs them via `pnpm dev` (which calls `pnpm db:migrate`
// before the dev server) or `pnpm db:migrate` directly. See
// docs/postgres-local-dev.md. Instrumentation-time migration was tried
// (commit cd540e85) but Turbopack's instrumentation pipeline doesn't
// honour `transpilePackages` for workspace imports, which forced type
// suppressions and duplicated `postgres`/`drizzle-orm` as platform-ui
// direct deps.

export async function register(): Promise<void> {
  // Only validate on the server runtime (not edge, not build-time).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // import() + webpackIgnore keeps node:fs out of webpack's dependency graph.
    // webpackIgnore works on import() in webpack 5; it does NOT work on require().
    const { existsSync } = await import(/* webpackIgnore: true */ 'node:fs');
    // validateEnv lives in a node-only module (it calls process.exit) so the
    // Edge runtime build never parses it. See instrumentation-node.ts.
    const { validateEnv } = await import('./instrumentation-node');
    validateEnv(existsSync);
  }
}

// ADR-0001 — Postgres migrations are NOT applied here. They run via
// `packages/platform-infra/scripts/migrate.mjs`, invoked by the
// production Dockerfile's CMD before `server.js`. Local dev runs them
// via `pnpm dev:postgres` (which calls `pnpm db:migrate` before the dev
// server) or `pnpm db:migrate` directly. See docs/postgres-local-dev.md.
// Instrumentation-time migration was tried (commit cd540e85) but
// Turbopack's instrumentation pipeline doesn't honour `transpilePackages`
// for workspace imports, which forced @ts-expect-error workarounds and
// duplicated `postgres`/`drizzle-orm` as platform-ui direct deps.

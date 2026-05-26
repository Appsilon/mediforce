// Sibling boot helper for `instrumentation.ts`. Lives in platform-ui so
// Turbopack's instrumentation pipeline does not have to cross a workspace
// boundary (its `transpilePackages` config is not honoured for files in
// the instrumentation graph). The two foreign imports below resolve fine:
//
//   - drizzle-orm/postgres-js: TS transparent, no schema graph
//   - postgres: pure JS, single file
//
// Both are pulled in transitively via `@mediforce/platform-infra`'s
// dependency tree (pnpm hoists them when `transpilePackages` includes
// platform-infra). Declared on platform-ui too so the resolver finds
// them when instrumentation skips the alias graph.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
// @ts-expect-error — see note in instrumentation.ts: Turbopack's
// instrumentation pipeline rejects `.js` extensions on relative imports
// out of platform-ui, but TS rejects `.ts` extensions without
// `allowImportingTsExtensions` (incompatible with `tsc -b --noEmit` at
// the repo root). The migrator file's types still flow through because
// platform-infra/tsconfig.json includes it in the normal compilation.
import { applyPostgresMigrations } from '../../platform-infra/src/postgres/migrator.ts';

/**
 * Open a one-shot Postgres connection, apply pending migrations, close.
 *
 * Uses its own pool (size 1) instead of `getSharedPostgresClient()` so the
 * instrumentation graph never imports platform-infra's repository
 * surface. The shared production pool is built later, on first request,
 * by `getPlatformServices()` — separate connection, separate lifecycle.
 */
export async function runBootMigrations(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('DATABASE_URL is not set (validated upstream — should not happen).');
  }
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client);
    await applyPostgresMigrations(db);
  } finally {
    await client.end({ timeout: 5 });
  }
}

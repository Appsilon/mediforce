import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/**
 * Resolve the SQL migrations folder shipped with this package. The folder is
 * a sibling of this file at runtime (`src/postgres/migrations` in dev,
 * `dist/postgres/migrations` once built) regardless of who imports it. Using
 * `import.meta.url` keeps the path stable across the @mediforce/source
 * dev/build modes and the eventual standalone Next.js bundle.
 */
function getMigrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'migrations');
}

/**
 * Apply any pending drizzle-kit migrations to the given database. Idempotent —
 * drizzle tracks applied migrations in the `__drizzle_migrations` table
 * (two underscores; drizzle's own convention), so subsequent calls against an
 * up-to-date database are no-ops. Safe to invoke on every app boot.
 *
 * Wired into `platform-ui` boot via `instrumentation.ts` when
 * `STORAGE_BACKEND=postgres`. A future multi-replica deployment will gate this
 * behind a Postgres advisory lock; today's deploys are single-container per
 * `docker-compose.prod.yml`.
 */
export async function applyPostgresMigrations<TSchema extends Record<string, unknown>>(
  // Generic over the schema so callers from `platform-services` (typed
  // with the full schema) and from boot hooks (typed with an empty schema)
  // both fit. The migrator never touches schema-typed methods, so this
  // file does not need to depend on `./client.ts`. Keeping it
  // self-contained lets boot hooks import the migrator without dragging
  // the full schema graph along with it.
  db: PostgresJsDatabase<TSchema>,
): Promise<void> {
  await migrate(db, { migrationsFolder: getMigrationsFolder() });
}

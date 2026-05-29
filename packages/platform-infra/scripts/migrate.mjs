#!/usr/bin/env node
// ADR-0001 — Apply pending Postgres migrations.
// Invocation paths:
//   - Production Dockerfile CMD wraps this before server.js so prod
//     containers self-migrate on start.
//   - `pnpm dev:postgres` runs `pnpm db:migrate` (drizzle-kit CLI)
//     before booting the dev server — same outcome, different runner.
// Idempotent via drizzle's `drizzle.__drizzle_migrations` ledger, so
// re-running is always safe.
//
// No-op when STORAGE_BACKEND != 'postgres'. Crashes the container start
// (non-zero exit) on any migration failure — fail-stop is the right
// posture: an app boot against a half-migrated schema is worse than
// "container failed to start".
//
// Static imports are limited to node: builtins so this script can be
// loaded by the Next.js standalone runner even when `postgres` /
// `drizzle-orm` are not in the standalone bundle. The flag check then
// either exits 0 (Firestore mode) or dynamically imports the
// driver-only-needed packages.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.STORAGE_BACKEND !== 'postgres') {
  console.log('[migrate-postgres] STORAGE_BACKEND != postgres — skipping migrations.');
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (typeof url !== 'string' || url.length === 0) {
  console.error('[migrate-postgres] STORAGE_BACKEND=postgres requires DATABASE_URL.');
  process.exit(1);
}

const { default: postgres } = await import('postgres');
const { drizzle } = await import('drizzle-orm/postgres-js');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at packages/platform-infra/scripts/migrate.mjs; the
// migrations folder is a sibling under src/postgres/migrations. Same
// path resolution works in source tree, runner-stage Docker layout
// (Dockerfile copies both to /app/packages/platform-infra/...), and the
// CI workspace.
const migrationsFolder = resolve(__dirname, '..', 'src', 'postgres', 'migrations');

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder });
  console.log('[migrate-postgres] Migrations applied (or already up to date).');
} catch (err) {
  console.error('[migrate-postgres] Migration failed:', err);
  process.exitCode = 1;
} finally {
  await client.end({ timeout: 5 });
}

#!/usr/bin/env node
// ADR-0001 — Apply pending Postgres migrations before the app starts.
// Invoked by the production Dockerfile's CMD, runs once per container
// start. Idempotent via drizzle's `drizzle.__drizzle_migrations` ledger,
// so unchanged deployments are a no-op.
//
// Local dev does NOT run this automatically — see docs/postgres-local-dev.md
// for the manual `pnpm db:migrate` flow.
//
// No-op when STORAGE_BACKEND != 'postgres'. Crashes the container start
// (non-zero exit) on any migration failure — fail-stop is the right
// posture: an app boot against a half-migrated schema is worse than
// "container failed to start".

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
// In the runner stage of platform-ui's Dockerfile the migrations folder is
// copied to `/app/packages/platform-infra/src/postgres/migrations` (see
// Dockerfile §runner). This script lives at
// `/app/packages/platform-ui/scripts/migrate-postgres.mjs`, so relative
// resolution lands on the right directory.
const migrationsFolder = resolve(__dirname, '..', '..', 'platform-infra', 'src', 'postgres', 'migrations');

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

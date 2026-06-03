#!/usr/bin/env node
/**
 * Post-migration eager sync script.
 * Called by the `migrate` Docker service after drizzle-kit migrate.
 * Exits 0 even on sync failure — sync failure must not block boot.
 */
import { eagerSyncIfStale } from './eager-sync';
import { createPostgresClient } from '../postgres/client';
import { PostgresModelRegistryRepository } from '../postgres/repositories/model-registry-repository';
import { PostgresAuditRepository } from '../postgres/repositories/audit-repository';
import { PostgresProcessInstanceRepository } from '../postgres/repositories/process-instance-repository';

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[migrate-with-sync] No DATABASE_URL, skipping eager sync.');
    return;
  }
  const { db } = createPostgresClient({ url });
  const repo = new PostgresModelRegistryRepository(db);
  const instanceRepo = new PostgresProcessInstanceRepository(db);
  const auditRepo = new PostgresAuditRepository(db, instanceRepo);
  await eagerSyncIfStale(repo, { auditRepo });
}

main().catch((err) => {
  console.error('[migrate-with-sync] Unexpected error:', err);
});

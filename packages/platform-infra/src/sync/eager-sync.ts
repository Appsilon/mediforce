import type { AuditRepository, ModelRegistryRepository } from '@mediforce/platform-core';
import type { SyncResult } from './openrouter-sync';
import { syncFromOpenRouter } from './openrouter-sync';
import { isRegistryStale } from './model-sync-scheduler';

/**
 * Run a sync if the registry is stale (>24h or empty).
 * Designed for the migrate container's boot sequence.
 * Does NOT retry — the migrate container is a one-shot init container.
 * If the sync fails, log the error and continue (don't block boot).
 *
 * When auditRepo is provided, a failure audit entry is emitted on sync failure.
 * Audit failure is swallowed — it must never block boot.
 */
export async function eagerSyncIfStale(
  repo: ModelRegistryRepository,
  opts?: { auditRepo?: AuditRepository },
): Promise<{ ran: boolean; result?: SyncResult; error?: string }> {
  const stale = await isRegistryStale(repo);
  if (!stale) {
    console.log('[eager-sync] Registry is fresh, skipping sync.');
    return { ran: false };
  }
  console.log('[eager-sync] Registry is stale, running sync...');
  try {
    const result = await syncFromOpenRouter(repo);
    console.log(
      `[eager-sync] Sync complete: ${result.synced} synced, ${result.retired} retired, ${result.reinstated} reinstated.`,
    );
    return { ran: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[eager-sync] Sync failed: ${message}`);
    if (opts?.auditRepo) {
      try {
        await opts.auditRepo.append({
          actorId: 'system',
          actorType: 'system',
          actorRole: 'system',
          action: 'model_sync.eager_failed',
          description: `Boot-time sync failed: ${message}`,
          timestamp: new Date().toISOString(),
          entityType: 'model_registry',
          entityId: 'openrouter',
          basis: 'boot-eager-sync',
          inputSnapshot: {},
          outputSnapshot: { error: message },
        });
      } catch {
        // Audit failure must never block boot
      }
    }
    return { ran: true, error: message };
  }
}

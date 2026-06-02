import type { ModelRegistryRepository } from '@mediforce/platform-core';
import type { SyncResult } from './openrouter-sync';
import { syncFromOpenRouter } from './openrouter-sync';
import { isRegistryStale } from './model-sync-scheduler';

/**
 * Run a sync if the registry is stale (>24h or empty).
 * Designed for the migrate container's boot sequence.
 * Does NOT retry — the migrate container is a one-shot init container.
 * If the sync fails, log the error and continue (don't block boot).
 */
export async function eagerSyncIfStale(
  repo: ModelRegistryRepository,
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
    return { ran: true, error: message };
  }
}

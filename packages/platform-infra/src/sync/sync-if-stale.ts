import type { AuditRepository, ModelRegistryRepository } from '@mediforce/platform-core';
import type { SyncResult } from './openrouter-sync';
import { syncFromOpenRouter } from './openrouter-sync';
import { isRegistryStale } from './model-sync-scheduler';

/**
 * Run a sync if the registry is stale (>24h or empty). Used by the migrate
 * container's boot sequence and by the cron heartbeat's registry sweep, so a
 * long-lived deployment refreshes its catalogue (and model rankings) daily
 * without anyone running a script.
 * Does NOT retry — the migrate container is a one-shot init container, and the
 * next heartbeat is the retry for the sweep.
 * If the sync fails, log the error and continue (never throw — it must not
 * block boot or sink a beat).
 *
 * `ENABLE_MODEL_SYNC=false` turns the unattended sync off, for an estate with
 * no outbound route to openrouter.ai and for the E2E servers, whose registry
 * must be the seeded fixture and not a live catalogue that reorders under the
 * assertions. The "Sync Now" button still calls `syncFromOpenRouter` directly:
 * this gates the automatic path, not an operator who explicitly asked. On by
 * default, so a normal deployment needs no env flip.
 *
 * When auditRepo is provided, a failure audit entry is emitted on sync failure.
 * Audit failure is swallowed.
 */
export async function syncRegistryIfStale(
  repo: ModelRegistryRepository,
  opts?: { auditRepo?: AuditRepository },
): Promise<{ ran: boolean; result?: SyncResult; error?: string }> {
  if (process.env.ENABLE_MODEL_SYNC === 'false') {
    console.log('[model-sync] ENABLE_MODEL_SYNC=false, skipping sync.');
    return { ran: false };
  }
  const stale = await isRegistryStale(repo);
  if (!stale) {
    console.log('[model-sync] Registry is fresh, skipping sync.');
    return { ran: false };
  }
  console.log('[model-sync] Registry is stale, running sync...');
  try {
    const result = await syncFromOpenRouter(repo);
    console.log(
      `[model-sync] Sync complete: ${result.synced} synced, ${result.retired} retired, ${result.reinstated} reinstated.`,
    );
    return { ran: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[model-sync] Sync failed: ${message}`);
    if (opts?.auditRepo) {
      try {
        await opts.auditRepo.append({
          actorId: 'system',
          actorType: 'system',
          actorRole: 'system',
          namespace: '_system',
          action: 'model_sync.failed',
          description: `Stale-registry sync failed: ${message}`,
          timestamp: new Date().toISOString(),
          entityType: 'model_registry',
          entityId: 'openrouter',
          basis: 'sync-if-stale',
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

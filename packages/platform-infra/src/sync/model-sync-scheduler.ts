import type { ModelRegistryRepository } from '@mediforce/platform-core';

export const MODEL_SYNC_CRON = '0 3 * * *';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Check whether the model registry is stale.
 * Stale means: no models exist, or the most recent lastSyncedAt is older
 * than `thresholdMs` (default 24h).
 */
export async function isRegistryStale(
  repo: ModelRegistryRepository,
  thresholdMs: number = STALE_THRESHOLD_MS,
): Promise<boolean> {
  const models = await repo.list();
  if (models.length === 0) return true;
  const latest = models.reduce((max, m) => (m.lastSyncedAt > max ? m.lastSyncedAt : max), '');
  if (!latest) return true;
  const age = Date.now() - new Date(latest).getTime();
  return age > thresholdMs;
}

import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { syncWithRetry, sendSyncFailureWebhook } from '@mediforce/platform-infra';
import { emitAudit } from '@mediforce/platform-api';
import type { CallerIdentity } from '@mediforce/platform-api';

/**
 * GET /api/cron/model-sync
 *
 * Daily cron endpoint (schedule: 0 3 * * *).
 * Uses syncWithRetry (3 retries, 1hr intervals).
 * Emits an audit entry per failed retry attempt, on final success, and on final failure.
 *
 * Vercel Cron: add to vercel.json crons array:
 *   { "crons": [{ "path": "/api/cron/model-sync", "schedule": "0 3 * * *" }] }
 *
 * External cron: curl -H "Authorization: Bearer $CRON_SECRET" \
 *   https://domain/api/cron/model-sync
 */
export async function GET(request: Request): Promise<NextResponse> {
  // Verify CRON_SECRET if set (Vercel Cron sends this automatically)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const { modelRegistryRepo, auditRepo, platformSettingsRepo } = getPlatformServices();
  const systemCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };
  const maxRetries = 3;

  try {
    const result = await syncWithRetry(modelRegistryRepo, {
      maxRetries,
      onAttemptFail: async (attempt, error) => {
        await emitAudit(auditRepo, systemCaller, {
          action: 'model_sync.attempt_failed',
          namespace: '_system',
          description: `Sync attempt ${attempt} failed: ${error.message}`,
          entityType: 'model_registry',
          entityId: 'openrouter',
          basis: 'cron-0-3-daily',
          inputSnapshot: { attempt },
          outputSnapshot: { error: error.message },
        });
      },
    });
    await emitAudit(auditRepo, systemCaller, {
      action: 'model_sync.completed',
      namespace: '_system',
      description: `Sync completed: ${result.synced} synced, ${result.retired} retired, ${result.reinstated} reinstated`,
      entityType: 'model_registry',
      entityId: 'openrouter',
      basis: 'cron-0-3-daily',
      inputSnapshot: {},
      outputSnapshot: { ...result },
    });
    return NextResponse.json(result);
  } catch (err) {
    await emitAudit(auditRepo, systemCaller, {
      action: 'model_sync.failed',
      namespace: '_system',
      description: `Sync failed after all retries: ${err instanceof Error ? err.message : 'Sync failed after retries'}`,
      entityType: 'model_registry',
      entityId: 'openrouter',
      basis: 'cron-0-3-daily',
      inputSnapshot: {},
      outputSnapshot: { error: err instanceof Error ? err.message : 'Sync failed after retries' },
    });
    await sendSyncFailureWebhook(platformSettingsRepo, {
      errorMessage: err instanceof Error ? err.message : 'Sync failed after retries',
      attemptCount: maxRetries + 1,
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed after retries' },
      { status: 502 },
    );
  }
}

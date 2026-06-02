import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { syncWithRetry } from '@mediforce/platform-infra';

/**
 * GET /api/cron/model-sync
 *
 * Daily cron endpoint (schedule: 0 3 * * *).
 * Uses syncWithRetry (3 retries, 1hr intervals).
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

  const { modelRegistryRepo } = getPlatformServices();
  try {
    const result = await syncWithRetry(modelRegistryRepo);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sync failed after retries' },
      { status: 502 },
    );
  }
}

import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { testWebhook } from '@mediforce/platform-api/handlers';

/**
 * POST /api/config/test-webhook
 *
 * Sends a test notification to the configured webhook URL.
 * System-actor only (API key required). Used by `mediforce config test-webhook`.
 */
export async function POST(): Promise<NextResponse> {
  const { platformSettingsRepo } = getPlatformServices();
  try {
    const result = await testWebhook({ platformSettingsRepo });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to test webhook' },
      { status: 500 },
    );
  }
}

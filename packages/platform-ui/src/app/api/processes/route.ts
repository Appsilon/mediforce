import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey, getAppBaseUrl } from '@/lib/platform-services';

interface StartProcessBody {
  definitionName: string;
  version: string;
  configName: string;
  configVersion: string;
  triggeredBy: string;
  triggerName: string;
  payload: Record<string, unknown>;  // { studyId, ... }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json() as StartProcessBody;
    const { manualTrigger } = getPlatformServices();

    const result = await manualTrigger.fire({
      definitionName: body.definitionName,
      definitionVersion: body.version,
      configName: body.configName,
      configVersion: body.configVersion,
      triggerName: body.triggerName,
      triggeredBy: body.triggeredBy,
      payload: body.payload,
    });

    // Fire-and-forget: trigger auto-runner asynchronously (do not await — start returns immediately)
    const baseUrl = getAppBaseUrl();
    fetch(`${baseUrl}/api/processes/${result.instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({
        appContext: body.payload ?? {},
        triggeredBy: body.triggeredBy,
      }),
    }).catch((err) => {
      // Log but don't fail the start request — run status tracked via Firestore
      console.error(`[auto-runner] Failed to trigger run for ${result.instanceId}:`, err);
    });

    return NextResponse.json({ instanceId: result.instanceId, status: result.status }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

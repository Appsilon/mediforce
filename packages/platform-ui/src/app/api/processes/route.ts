import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

interface StartWorkflowBody {
  definitionName: string;
  definitionVersion?: number;
  version?: string | number;
  triggeredBy: string;
  triggerName?: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as StartWorkflowBody;
    const { manualTrigger, processRepo } = getPlatformServices();

    let version = body.definitionVersion ?? (body.version ? Number(body.version) : undefined);
    if (!version) {
      version = await processRepo.getLatestWorkflowVersion(body.definitionName);
      if (version === 0) {
        return NextResponse.json(
          { error: `No workflow definition found for '${body.definitionName}'` },
          { status: 404 },
        );
      }
    }

    const result = await manualTrigger.fireWorkflow({
      definitionName: body.definitionName,
      definitionVersion: version,
      triggerName: body.triggerName ?? 'manual',
      triggeredBy: body.triggeredBy,
      payload: body.payload ?? {},
    });

    // Fire-and-forget: trigger auto-runner asynchronously
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
      console.error(`[auto-runner] Failed to trigger run for ${result.instanceId}:`, err);
    });

    return NextResponse.json({ instanceId: result.instanceId, status: result.status }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

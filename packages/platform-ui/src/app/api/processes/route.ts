import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey, getAppBaseUrl } from '@/lib/platform-services';

/** @deprecated Legacy — use WorkflowDefinition body (no configName) instead. */
interface StartProcessBody {
  definitionName: string;
  version: string;
  configName: string;
  configVersion: string;
  triggeredBy: string;
  triggerName: string;
  payload: Record<string, unknown>;
}

interface StartWorkflowBody {
  definitionName: string;
  definitionVersion?: number;
  triggeredBy: string;
  triggerName?: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { manualTrigger } = getPlatformServices();

    // Detect: if configName is present → legacy path; otherwise → workflow path
    const isLegacy = 'configName' in body && body.configName;

    let result;
    if (isLegacy) {
      const legacy = body as StartProcessBody;
      result = await manualTrigger.fire({
        definitionName: legacy.definitionName,
        definitionVersion: legacy.version,
        configName: legacy.configName,
        configVersion: legacy.configVersion,
        triggerName: legacy.triggerName,
        triggeredBy: legacy.triggeredBy,
        payload: legacy.payload,
      });
    } else {
      const workflow = body as StartWorkflowBody;
      let version = workflow.definitionVersion;
      if (!version) {
        const { processRepo } = getPlatformServices();
        version = await processRepo.getLatestWorkflowVersion(workflow.definitionName);
        if (version === 0) {
          return NextResponse.json(
            { error: `No workflow definition found for '${workflow.definitionName}'` },
            { status: 404 },
          );
        }
      }
      result = await manualTrigger.fireWorkflow({
        definitionName: workflow.definitionName,
        definitionVersion: version,
        triggerName: workflow.triggerName ?? 'manual',
        triggeredBy: workflow.triggeredBy,
        payload: workflow.payload ?? {},
      });
    }

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

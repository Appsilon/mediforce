import { NextRequest, NextResponse } from 'next/server';
import { validatePayload } from '@mediforce/platform-core';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

interface StartWorkflowBody {
  definitionName: string;
  definitionVersion?: number;
  version?: string | number;
  triggeredBy: string;
  triggerName?: string;
  payload?: Record<string, unknown> | null;
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

    if (body.payload !== undefined && body.payload !== null && (typeof body.payload !== 'object' || Array.isArray(body.payload))) {
      return NextResponse.json(
        { error: 'payload must be a JSON object or omitted' },
        { status: 400 },
      );
    }
    const payload: Record<string, unknown> = (body.payload as Record<string, unknown>) ?? {};

    const definition = await processRepo.getWorkflowDefinition(body.definitionName, version);
    if (!definition) {
      return NextResponse.json(
        { error: `Workflow definition '${body.definitionName}' v${version} not found` },
        { status: 404 },
      );
    }
    if (definition.triggerInput && definition.triggerInput.length > 0) {
      const validation = validatePayload(payload, definition.triggerInput);
      if (!validation.valid) {
        return NextResponse.json(
          { error: 'Invalid payload', details: validation.errors },
          { status: 400 },
        );
      }
    }

    const result = await manualTrigger.fireWorkflow({
      definitionName: body.definitionName,
      definitionVersion: version,
      triggerName: body.triggerName ?? 'manual',
      triggeredBy: body.triggeredBy,
      payload,
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
        appContext: payload,
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

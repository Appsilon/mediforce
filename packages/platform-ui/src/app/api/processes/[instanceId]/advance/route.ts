import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { executeAgentStep } from '@/lib/execute-agent-step';

interface AdvanceStepBody {
  stepId: string;
  appContext: Record<string, unknown>;
  triggeredBy: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { instanceId } = await params;
    const body = await req.json() as AdvanceStepBody;

    // Load instance + definition to get the WorkflowStep
    const { instanceRepo, processRepo } = getPlatformServices();
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const versionNum = parseInt(instance.definitionVersion, 10);
    const latestVersion = isNaN(versionNum)
      ? await processRepo.getLatestWorkflowVersion(instance.definitionName)
      : versionNum;
    const definition = await processRepo.getWorkflowDefinition(instance.definitionName, latestVersion);
    if (!definition) {
      return NextResponse.json({ error: 'Definition not found' }, { status: 404 });
    }

    const workflowStep = definition.steps.find((s) => s.id === body.stepId);
    if (!workflowStep) {
      return NextResponse.json({ error: `Step '${body.stepId}' not found in definition` }, { status: 404 });
    }

    const result = await executeAgentStep(
      instanceId,
      body.stepId,
      workflowStep,
      body.appContext,
      body.triggeredBy,
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

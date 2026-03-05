import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/platform-services';
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

    const result = await executeAgentStep(
      instanceId,
      body.stepId,
      body.appContext,
      body.triggeredBy,
    );

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

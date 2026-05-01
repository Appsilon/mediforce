import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { ListRunsInputSchema } from '@mediforce/platform-api/contract';
import { getCallerNamespaces } from '../workflow-definitions/auth.js';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;

  const parseResult = ListRunsInputSchema.safeParse({
    workflow: params.get('workflow') ?? undefined,
    status: params.get('status') ?? undefined,
    limit: params.get('limit') ?? undefined,
  });

  if (!parseResult.success) {
    return NextResponse.json(
      { error: parseResult.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { workflow, status, limit } = parseResult.data;

  try {
    const { instanceRepo, namespaceRepo } = getPlatformServices();
    const callerNs = await getCallerNamespaces(req, namespaceRepo);
    if (callerNs instanceof NextResponse) return callerNs;

    const instances = await instanceRepo.list({
      definitionName: workflow,
      status,
      limit,
    });

    const filtered = callerNs === null
      ? instances
      : instances.filter((inst) => inst.namespace === undefined || callerNs.has(inst.namespace));

    const runs = filtered.map((inst) => ({
      runId: inst.id,
      status: inst.status,
      definitionName: inst.definitionName,
      definitionVersion: inst.definitionVersion,
      currentStepId: inst.currentStepId,
      error: inst.error,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
      createdBy: inst.createdBy,
    }));

    return NextResponse.json({ runs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import type { InstanceStatus } from '@mediforce/platform-core';

const VALID_STATUSES = new Set<InstanceStatus>([
  'created',
  'running',
  'paused',
  'completed',
  'failed',
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;

  const workflow = params.get('workflow') ?? undefined;
  const statusRaw = params.get('status') ?? undefined;
  const limitRaw = params.get('limit');
  const limit = limitRaw !== null ? Math.min(Math.max(Number(limitRaw) || 20, 1), 100) : 20;

  if (statusRaw !== undefined && !VALID_STATUSES.has(statusRaw as InstanceStatus)) {
    return NextResponse.json(
      { error: `Invalid status: ${statusRaw}` },
      { status: 400 },
    );
  }
  const status = statusRaw as InstanceStatus | undefined;

  const { instanceRepo } = getPlatformServices();
  const instances = await instanceRepo.list({
    definitionName: workflow,
    status,
    limit,
  });

  const runs = instances.map((inst) => ({
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
}

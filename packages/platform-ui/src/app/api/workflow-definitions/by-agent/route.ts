import { NextResponse } from 'next/server';
import { findWorkflowAgentUsage } from '@mediforce/platform-api/handlers';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

/**
 * Which workflows currently run the given Agent — the "used by" answer on
 * the Agent's Versions tab. Reads the runnable version of each workflow, so
 * the answer is a stable "where is this used today", not every historical run.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const url = new URL(request.url);
  const agentId = url.searchParams.get('agentId');
  if (agentId === null || agentId.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: agentId' },
      { status: 400 },
    );
  }

  // Full scan — Firestore can't query nested steps[].agentId.
  const { definitions } = await processRepo.listAllWorkflowDefinitions(false);
  const workflows = findWorkflowAgentUsage(definitions, agentId)
    .filter(
      (usage) =>
        caller.isSystemActor ||
        caller.namespaces.has(usage.namespace) ||
        usage.visibility === 'public',
    )
    .map(({ visibility: _visibility, ...usage }) => usage);

  return NextResponse.json({ workflows });
}

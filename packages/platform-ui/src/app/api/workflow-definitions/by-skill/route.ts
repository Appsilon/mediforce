import { NextResponse } from 'next/server';
import { findWorkflowSkillUsage } from '@mediforce/platform-api/handlers';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

/**
 * The Skills each live workflow runs with: named on a step directly, and the
 * agents a step references (whose Skills it inherits). Feeds "used in N
 * workflows" on the Skills pages.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  // Full scan — Firestore can't query nested steps[].agent.skills.
  const { definitions } = await processRepo.listAllWorkflowDefinitions(false);
  const workflows = findWorkflowSkillUsage(definitions)
    .filter(
      (usage) =>
        caller.isSystemActor ||
        caller.namespaces.has(usage.namespace) ||
        usage.visibility === 'public',
    )
    .map(({ visibility: _visibility, ...usage }) => usage);

  return NextResponse.json({ workflows });
}

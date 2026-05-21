import { NextResponse } from 'next/server';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { WorkflowDefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';
import { listWorkflowDefinitions } from '@mediforce/platform-api/handlers';
import { ListWorkflowDefinitionsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-definitions
 *
 * List workflow definitions visible to the caller. Workspace + visibility
 * filtering lives in `scope.workflowDefinitions`; the optional `?namespace=`
 * query param narrows further but does not grant access.
 */
export const GET = createRouteAdapter(
  ListWorkflowDefinitionsInputSchema,
  (req) => {
    const url = new URL(req.url);
    const namespace = url.searchParams.get('namespace');
    return namespace !== null ? { namespace } : {};
  },
  listWorkflowDefinitions,
);

/**
 * POST /api/workflow-definitions?namespace=handle
 *
 * Register a new WorkflowDefinition. Version is auto-incremented from the
 * latest existing version for the given name. Send the definition JSON
 * without `version` or `createdAt` — they are set server-side.
 *
 * The `namespace` query parameter is required and sets the owning namespace.
 * It overrides any `namespace` field in the request body.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  if (!namespace) {
    return NextResponse.json(
      { error: 'Missing required query parameter: namespace' },
      { status: 400 },
    );
  }

  const denied = requireNamespaceAccess(caller, namespace);
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = parseWorkflowDefinitionForCreation({
    ...body,
    namespace,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { processRepo } = getPlatformServices();

  try {
    const latestVersion = await processRepo.getLatestWorkflowVersion(namespace, parsed.data.name);
    const nextVersion = latestVersion + 1;

    const definition = {
      ...parsed.data,
      version: nextVersion,
      createdAt: new Date().toISOString(),
    };

    await processRepo.saveWorkflowDefinition(definition);

    return NextResponse.json(
      { success: true, name: definition.name, version: definition.version },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof WorkflowDefinitionVersionAlreadyExistsError) {
      return NextResponse.json({ error: 'Version conflict — please retry.' }, { status: 409 });
    }
    throw err;
  }
}

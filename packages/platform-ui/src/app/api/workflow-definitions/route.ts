import { NextResponse } from 'next/server';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';
import { WorkflowDefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

/**
 * GET /api/workflow-definitions
 *
 * List all registered workflow definitions. Returns each workflow's latest
 * version as a full WorkflowDefinition object, suitable for loading into
 * the Workflow Designer edit flow.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { processRepo } = getPlatformServices();
  const { definitions } = await processRepo.listWorkflowDefinitions();

  const result = definitions.map((group) => {
    const latest = group.versions.find((v) => v.version === group.latestVersion);
    return {
      name: group.name,
      latestVersion: group.latestVersion,
      defaultVersion: group.defaultVersion,
      definition: latest ?? null,
    };
  });

  return NextResponse.json({ definitions: result });
}

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
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  if (!namespace) {
    return NextResponse.json(
      { error: 'Missing required query parameter: namespace' },
      { status: 400 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = WorkflowDefinitionSchema.omit({ version: true, createdAt: true }).safeParse({
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
    const latestVersion = await processRepo.getLatestWorkflowVersion(parsed.data.name);
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

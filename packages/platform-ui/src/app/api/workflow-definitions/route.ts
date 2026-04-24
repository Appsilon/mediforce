import { NextResponse } from 'next/server';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';
import { WorkflowDefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { listWorkflowDefinitions } from '@mediforce/platform-api/handlers';
import { ListWorkflowDefinitionsInputSchema } from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-definitions
 *
 * List all registered workflow definitions. Each entry is a group (by
 * workflow name) with `latestVersion`, `defaultVersion`, and the latest
 * `definition` pre-resolved. Shape is identical to the pre-migration
 * route — the UI loads this directly into the Workflow Designer.
 */
export const GET = createRouteAdapter(
  ListWorkflowDefinitionsInputSchema,
  () => ({}),
  (input) =>
    listWorkflowDefinitions(input, { processRepo: getPlatformServices().processRepo }),
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
 *
 * Still inline because mutations are Phase 2 — see `docs/headless-migration.md`.
 */
export async function POST(request: Request): Promise<NextResponse> {
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

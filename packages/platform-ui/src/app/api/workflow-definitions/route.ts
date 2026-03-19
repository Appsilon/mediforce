import { NextResponse } from 'next/server';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';
import { WorkflowDefinitionVersionAlreadyExistsError } from '@mediforce/platform-infra';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';

/**
 * POST /api/workflow-definitions
 *
 * Register a new WorkflowDefinition. Version is auto-incremented from the
 * latest existing version for the given name. Send the definition JSON
 * without `version` or `createdAt` — they are set server-side.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!validateApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = WorkflowDefinitionSchema.omit({ version: true, createdAt: true }).safeParse(body);
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

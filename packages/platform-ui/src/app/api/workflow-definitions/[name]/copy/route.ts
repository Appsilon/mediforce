import { NextResponse, type NextRequest } from 'next/server';
import { CopyWorkflowInputSchema } from '@mediforce/platform-api/contract';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, callerCanAccess, requireNamespaceAccess } from '@/lib/api-auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name: sourceName } = await params;

  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const targetNamespace = request.nextUrl.searchParams.get('targetNamespace');
  if (!targetNamespace) {
    return NextResponse.json(
      { error: 'Missing required query parameter: targetNamespace' },
      { status: 400 },
    );
  }

  const denied = requireNamespaceAccess(caller, targetNamespace);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = CopyWorkflowInputSchema.safeParse({ name: sourceName, ...body as object });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const sourceVersion = parsed.data.version
    ?? await processRepo.getLatestWorkflowVersion(sourceName);

  if (sourceVersion === 0) {
    return NextResponse.json(
      { error: `Workflow '${sourceName}' not found` },
      { status: 404 },
    );
  }

  const source = await processRepo.getWorkflowDefinition(sourceName, sourceVersion);
  if (source === null) {
    return NextResponse.json(
      { error: `Workflow '${sourceName}' version ${sourceVersion} not found` },
      { status: 404 },
    );
  }

  if (!callerCanAccess(caller, source.namespace)) {
    if (source.visibility !== 'public') {
      return NextResponse.json(
        { error: `Workflow '${sourceName}' not found` },
        { status: 404 },
      );
    }
  }

  const copyName = parsed.data.targetName ?? sourceName;

  const existingVersion = await processRepo.getLatestWorkflowVersionInNamespace(
    copyName,
    targetNamespace,
  );
  if (existingVersion > 0) {
    return NextResponse.json(
      { error: `Workflow '${copyName}' already exists in namespace '${targetNamespace}'` },
      { status: 409 },
    );
  }

  const copiedFrom = {
    namespace: source.namespace,
    name: source.name,
    version: source.version,
  };

  const copy = {
    ...source,
    name: copyName,
    namespace: targetNamespace,
    version: 1,
    visibility: 'private' as const,
    copiedFrom,
    createdAt: new Date().toISOString(),
    archived: undefined,
    deleted: undefined,
  };

  await processRepo.saveWorkflowDefinition(copy);

  return NextResponse.json(
    { success: true, name: copyName, version: 1, copiedFrom },
    { status: 201 },
  );
}

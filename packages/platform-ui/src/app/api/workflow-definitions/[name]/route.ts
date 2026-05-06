import { NextResponse, type NextRequest } from 'next/server';
import { WorkflowVisibilitySchema } from '@mediforce/platform-core';
import { getAdminFirestore } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, callerCanAccess, requireNamespaceAccess } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  const versionParam = request.nextUrl.searchParams.get('version');

  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  let version: number;
  if (versionParam !== null) {
    version = Number(versionParam);
    if (!Number.isInteger(version) || version < 1) {
      return NextResponse.json(
        { error: `Invalid version: ${versionParam}` },
        { status: 400 },
      );
    }
  } else {
    version = await processRepo.getLatestWorkflowVersion(name);
    if (version === 0) {
      return NextResponse.json(
        { error: `Workflow '${name}' not found` },
        { status: 404 },
      );
    }
  }

  const definition = await processRepo.getWorkflowDefinition(name, version);
  if (definition === null) {
    return NextResponse.json(
      { error: `Workflow '${name}' not found` },
      { status: 404 },
    );
  }

  if (!callerCanAccess(caller, definition.namespace)) {
    if (definition.visibility === 'private') {
      return NextResponse.json(
        { error: `Workflow '${name}' not found` },
        { status: 404 },
      );
    }
  }

  return NextResponse.json({ definition });
}

/**
 * PATCH /api/workflow-definitions/:name
 *
 * Update mutable fields on all versions of a workflow.
 * Currently supports: { visibility: 'public' | 'private' }
 * Requires namespace membership (owner/admin enforced at UI level).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;

  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const latestVersion = await processRepo.getLatestWorkflowVersion(name);
  if (latestVersion === 0) {
    return NextResponse.json({ error: `Workflow '${name}' not found` }, { status: 404 });
  }
  const definition = await processRepo.getWorkflowDefinition(name, latestVersion);
  const denied = requireNamespaceAccess(caller, definition?.namespace);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = WorkflowVisibilitySchema.safeParse((body as Record<string, unknown>)?.visibility);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'visibility must be "public" or "private"' },
      { status: 400 },
    );
  }

  const db = getAdminFirestore();
  const snapshot = await db
    .collection('workflowDefinitions')
    .where('name', '==', name)
    .get();

  for (const docSnap of snapshot.docs) {
    await db.collection('workflowDefinitions').doc(docSnap.id).update({ visibility: parsed.data });
  }

  return NextResponse.json({ success: true, name, visibility: parsed.data });
}

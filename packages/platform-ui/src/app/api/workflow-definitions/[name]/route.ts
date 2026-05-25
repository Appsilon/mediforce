import { NextResponse, type NextRequest } from 'next/server';
import { WorkflowVisibilitySchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { createRouteAdapter } from '@/lib/route-adapter';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';
import { getWorkflow } from '@mediforce/platform-api/handlers';
import { GetWorkflowInputSchema } from '@mediforce/platform-api/contract';
import type { GetWorkflowInput } from '@mediforce/platform-api/contract';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * GET /api/workflow-definitions/:name
 *
 * Returns one workflow definition. Accepts optional `?version=` (defaults to
 * latest) and `?namespace=` (filters by owning namespace). Missing
 * name/version, namespace mismatch, and visibility-denied private workflows
 * all surface as 404 via `ApiError('not_found', …)` — visibility-denied is intentionally
 * 404 (anti-enumeration), not 403.
 */
export const GET = createRouteAdapter<
  typeof GetWorkflowInputSchema,
  GetWorkflowInput,
  unknown,
  RouteContext
>(
  GetWorkflowInputSchema,
  async (req, ctx) => {
    const { name } = await ctx.params;
    const url = new URL(req.url);
    const versionParam = url.searchParams.get('version');
    const namespaceParam = url.searchParams.get('namespace');
    const input: Record<string, unknown> = { name };
    if (versionParam !== null) {
      const parsed = Number(versionParam);
      input.version = Number.isFinite(parsed) ? parsed : versionParam;
    }
    if (namespaceParam !== null) input.namespace = namespaceParam;
    return input;
  },
  getWorkflow,
);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;

  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const patchNamespace = request.nextUrl.searchParams.get('namespace') ?? '';
  const latestVersion = await processRepo.getLatestWorkflowVersion(patchNamespace, name);
  if (latestVersion === 0) {
    return NextResponse.json({ error: `Workflow '${name}' not found` }, { status: 404 });
  }
  const definition = await processRepo.getWorkflowDefinition(patchNamespace, name, latestVersion);
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

  await processRepo.setWorkflowVisibility(name, definition?.namespace ?? '', parsed.data);

  return NextResponse.json({ success: true, name, visibility: parsed.data });
}

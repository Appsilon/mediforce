import { NextResponse } from 'next/server';
import { ToolCatalogEntryBaseSchema, ToolCatalogEntrySchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveNamespaceFromQuery } from '../helpers';

/** Partial-update payload: id cannot be renamed — bindings reference it. */
const ToolCatalogEntryPatchSchema = ToolCatalogEntryBaseSchema.omit({ id: true }).partial().strict();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const entry = await services.toolCatalogRepo.getById(namespace, id);
  if (entry === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ entry });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = ToolCatalogEntryPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await services.toolCatalogRepo.getById(namespace, id);
  if (existing === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // The base schema's `.omit().partial()` form drops the cross-field
  // refinement that requires either `command` (legacy) or `mcp` (new) to
  // be present. Re-validate the merged entry against the refined schema
  // so a PATCH that explicitly clears both is rejected before persisting.
  const merged = { ...existing, ...parsed.data, id };
  const refined = ToolCatalogEntrySchema.safeParse(merged);
  if (!refined.success) {
    return NextResponse.json(
      { error: 'Patched entry failed validation', issues: refined.error.issues },
      { status: 400 },
    );
  }

  const entry = await services.toolCatalogRepo.upsert(namespace, refined.data);
  return NextResponse.json({ entry });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  await services.toolCatalogRepo.delete(namespace, id);
  return NextResponse.json({ success: true });
}

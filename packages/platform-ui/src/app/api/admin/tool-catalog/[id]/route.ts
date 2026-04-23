import { NextResponse } from 'next/server';
import { ToolCatalogEntrySchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveNamespaceFromQuery } from '../helpers';

/** Partial-update payload: id cannot be renamed — bindings reference it. */
const ToolCatalogEntryPatchSchema = ToolCatalogEntrySchema.omit({ id: true }).partial().strict();

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

  const entry = await services.toolCatalogRepo.upsert(namespace, { ...existing, ...parsed.data, id });
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

  const existing = await services.toolCatalogRepo.getById(namespace, id);
  if (existing === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await services.toolCatalogRepo.delete(namespace, id);
  return NextResponse.json({ success: true });
}

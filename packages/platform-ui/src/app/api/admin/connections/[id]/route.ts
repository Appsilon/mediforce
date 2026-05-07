import { NextResponse } from 'next/server';
import { UpdateConnectionInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { requireAdminForNamespace, toPublicConnection } from '../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await requireAdminForNamespace(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const connection = await services.connectionRepo.getById(namespace, id);
  if (connection === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ connection: toPublicConnection(connection) });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await requireAdminForNamespace(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = UpdateConnectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updated = await services.connectionRepo.update(namespace, id, parsed.data);
  if (updated === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ connection: toPublicConnection(updated) });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await requireAdminForNamespace(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const deleted = await services.connectionRepo.delete(namespace, id);
  if (!deleted) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}

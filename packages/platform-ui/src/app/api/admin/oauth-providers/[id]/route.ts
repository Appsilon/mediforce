import { NextResponse } from 'next/server';
import { UpdateOAuthProviderInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveNamespaceFromQuery } from '../helpers';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const provider = await services.oauthProviderRepo.get(namespace, id);
  if (provider === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ provider });
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

  const parsed = UpdateOAuthProviderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const updated = await services.oauthProviderRepo.update(namespace, id, parsed.data);
  if (updated === null) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ provider: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  await services.oauthProviderRepo.delete(namespace, id);
  return NextResponse.json({ success: true });
}

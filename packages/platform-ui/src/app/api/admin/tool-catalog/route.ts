import { NextResponse } from 'next/server';
import { ToolCatalogEntrySchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveNamespaceFromQuery, slugifyCommand } from './helpers';

export async function GET(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const entries = await services.toolCatalogRepo.list(namespace);
  return NextResponse.json({ entries });
}

export async function POST(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const incoming = body as Record<string, unknown>;
  const id =
    typeof incoming.id === 'string' && incoming.id.length > 0
      ? incoming.id
      : typeof incoming.command === 'string'
        ? slugifyCommand(incoming.command)
        : '';
  if (id === '') {
    return NextResponse.json(
      { error: 'Unable to derive id: supply `id` or a non-empty `command`.' },
      { status: 400 },
    );
  }

  const parsed = ToolCatalogEntrySchema.safeParse({ ...incoming, id });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const existing = await services.toolCatalogRepo.getById(namespace, id);
  if (existing) {
    return NextResponse.json(
      { error: `Catalog entry "${id}" already exists in namespace "${namespace}".` },
      { status: 409 },
    );
  }

  const entry = await services.toolCatalogRepo.upsert(namespace, parsed.data);
  return NextResponse.json({ entry }, { status: 201 });
}

import { NextResponse } from 'next/server';
import {
  ConnectionAlreadyExistsError,
  CreateConnectionInputSchema,
} from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { requireAdminForNamespace, toPublicConnection } from './helpers';

export async function GET(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await requireAdminForNamespace(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const connections = await services.connectionRepo.list(namespace);
  return NextResponse.json({ connections: connections.map(toPublicConnection) });
}

export async function POST(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await requireAdminForNamespace(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = CreateConnectionInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const connection = await services.connectionRepo.create(namespace, parsed.data);
    return NextResponse.json({ connection: toPublicConnection(connection) }, { status: 201 });
  } catch (err) {
    if (err instanceof ConnectionAlreadyExistsError) {
      return NextResponse.json(
        { error: `Connection "${parsed.data.id}" already exists in namespace "${namespace}".` },
        { status: 409 },
      );
    }
    throw err;
  }
}

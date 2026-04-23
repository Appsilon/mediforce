import { NextResponse } from 'next/server';
import {
  CreateOAuthProviderInputSchema,
  ProviderAlreadyExistsError,
} from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveNamespaceFromQuery } from './helpers';

export async function GET(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const providers = await services.oauthProviderRepo.list(namespace);
  return NextResponse.json({ providers });
}

export async function POST(request: Request): Promise<NextResponse> {
  const services = getPlatformServices();
  const namespace = await resolveNamespaceFromQuery(request, services.namespaceRepo);
  if (namespace instanceof NextResponse) return namespace;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'JSON body is required' }, { status: 400 });
  }

  const parsed = CreateOAuthProviderInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const provider = await services.oauthProviderRepo.create(namespace, parsed.data);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    if (err instanceof ProviderAlreadyExistsError) {
      return NextResponse.json(
        { error: `OAuth provider "${parsed.data.id}" already exists in namespace "${namespace}".` },
        { status: 409 },
      );
    }
    throw err;
  }
}

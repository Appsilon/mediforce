import { NextResponse } from 'next/server';
import {
  getAdminFirestore,
  FirestoreWorkflowSecretsRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { getCallerNamespaces } from '../workflow-definitions/auth.js';

function getSecretsRepo() {
  getPlatformServices();
  return new FirestoreWorkflowSecretsRepository(getAdminFirestore());
}

/**
 * GET /api/workflow-secrets?namespace=x&workflow=y
 *
 * Returns secret key names only (never values).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  const workflow = url.searchParams.get('workflow');
  if (!namespace || !workflow) {
    return NextResponse.json(
      { error: 'Missing required query parameters: namespace, workflow' },
      { status: 400 },
    );
  }

  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const keys = await getSecretsRepo().getSecretKeys(namespace, workflow);
  return NextResponse.json({ keys });
}

/**
 * PUT /api/workflow-secrets?namespace=x&workflow=y
 *
 * Body: { "key": "SECRET_NAME", "value": "secret-value" }
 *
 * Upserts a single secret key. Existing secrets for the workflow are preserved.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  const workflow = url.searchParams.get('workflow');
  if (!namespace || !workflow) {
    return NextResponse.json(
      { error: 'Missing required query parameters: namespace, workflow' },
      { status: 400 },
    );
  }

  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (
    typeof body !== 'object' ||
    body === null ||
    typeof (body as Record<string, unknown>).key !== 'string' ||
    typeof (body as Record<string, unknown>).value !== 'string'
  ) {
    return NextResponse.json(
      { error: 'Body must contain "key" (string) and "value" (string)' },
      { status: 400 },
    );
  }

  const { key, value } = body as { key: string; value: string };
  if (key.length === 0 || value.length === 0) {
    return NextResponse.json(
      { error: 'Both "key" and "value" must be non-empty strings' },
      { status: 400 },
    );
  }

  const repo = getSecretsRepo();
  const existing = await repo.getSecrets(namespace, workflow);
  existing[key] = value;
  await repo.setSecrets(namespace, workflow, existing);

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/workflow-secrets?namespace=x&workflow=y&key=SECRET_NAME
 *
 * Removes a single secret key.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const { namespaceRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  const namespace = url.searchParams.get('namespace');
  const workflow = url.searchParams.get('workflow');
  const key = url.searchParams.get('key');
  if (!namespace || !workflow || !key) {
    return NextResponse.json(
      { error: 'Missing required query parameters: namespace, workflow, key' },
      { status: 400 },
    );
  }

  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const repo = getSecretsRepo();
  const existing = await repo.getSecrets(namespace, workflow);
  delete existing[key];
  await repo.setSecrets(namespace, workflow, existing);

  return NextResponse.json({ ok: true });
}

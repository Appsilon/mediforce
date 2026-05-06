import { NextResponse } from 'next/server';
import {
  SetSecretInputSchema,
  ListSecretKeysInputSchema,
  DeleteSecretInputSchema,
} from '@mediforce/platform-api/contract';
import { getPlatformServices } from '@/lib/platform-services';
import { getCallerNamespaces } from '../workflow-definitions/auth.js';

/**
 * GET /api/workflow-secrets?namespace=x[&workflow=y]
 *
 * Returns secret key names only (never values).
 * Without workflow: returns namespace-level secrets.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo, namespaceSecretsRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  const parsed = ListSecretKeysInputSchema.safeParse({
    namespace: url.searchParams.get('namespace') ?? undefined,
    workflow: url.searchParams.get('workflow') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { namespace, workflow } = parsed.data;
  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const keys = workflow
    ? await secretsRepo.getSecretKeys(namespace, workflow)
    : await namespaceSecretsRepo.getSecretKeys(namespace);
  return NextResponse.json({ keys });
}

/**
 * PUT /api/workflow-secrets?namespace=x[&workflow=y]
 *
 * Body: { "key": "SECRET_NAME", "value": "secret-value" }
 *
 * Upserts a single secret key atomically. Existing secrets are preserved.
 * Without workflow: operates on namespace-level secrets.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo, namespaceSecretsRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SetSecretInputSchema.safeParse({
    namespace: url.searchParams.get('namespace') ?? undefined,
    workflow: url.searchParams.get('workflow') ?? undefined,
    ...(typeof body === 'object' && body !== null ? body : {}),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { namespace, workflow, key, value } = parsed.data;
  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (workflow) {
    await secretsRepo.upsertSecret(namespace, workflow, key, value);
  } else {
    await namespaceSecretsRepo.upsertSecret(namespace, key, value);
  }
  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/workflow-secrets?namespace=x[&workflow=y]&key=SECRET_NAME
 *
 * Removes a single secret key atomically.
 * Without workflow: operates on namespace-level secrets.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo, namespaceSecretsRepo } = getPlatformServices();
  const callerNs = await getCallerNamespaces(request, namespaceRepo);
  if (callerNs instanceof NextResponse) return callerNs;

  const url = new URL(request.url);
  const parsed = DeleteSecretInputSchema.safeParse({
    namespace: url.searchParams.get('namespace') ?? undefined,
    workflow: url.searchParams.get('workflow') ?? undefined,
    key: url.searchParams.get('key') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const { namespace, workflow, key } = parsed.data;
  if (callerNs !== null && !callerNs.has(namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (workflow) {
    await secretsRepo.deleteSecret(namespace, workflow, key);
  } else {
    await namespaceSecretsRepo.deleteSecret(namespace, key);
  }
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import {
  SetSecretInputSchema,
  ListSecretKeysInputSchema,
  DeleteSecretInputSchema,
} from '@mediforce/platform-api/contract';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, callerCanAccess } from '@/lib/api-auth';

export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

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
  if (!callerCanAccess(caller, namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const keys = await secretsRepo.getSecretKeys(namespace, workflow);
  return NextResponse.json({ keys });
}

export async function PUT(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

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
  if (!callerCanAccess(caller, namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await secretsRepo.upsertSecret(namespace, workflow, key, value);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request): Promise<NextResponse> {
  const { namespaceRepo, secretsRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

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
  if (!callerCanAccess(caller, namespace)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await secretsRepo.deleteSecret(namespace, workflow, key);
  return NextResponse.json({ ok: true });
}

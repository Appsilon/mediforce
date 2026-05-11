import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { CreateApiKeyInputSchema } from '@mediforce/platform-core';
import { generateApiKey } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

const MAX_ACTIVE_KEYS = 10;

export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;
  if (caller.kind !== 'user') {
    return NextResponse.json({ error: 'Per-user auth required' }, { status: 403 });
  }

  const keys = await apiKeyRepo.listByUser(caller.uid);
  return NextResponse.json({
    keys: keys.map(({ keyHash: _, ...rest }) => rest),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;
  if (caller.kind !== 'user') {
    return NextResponse.json({ error: 'Per-user auth required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateApiKeyInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => i.message).join('; ') },
      { status: 400 },
    );
  }

  const existing = await apiKeyRepo.listByUser(caller.uid);
  const active = existing.filter((k) => !k.revokedAt);
  if (active.length >= MAX_ACTIVE_KEYS) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ACTIVE_KEYS} active API keys per user` },
      { status: 429 },
    );
  }

  const { plaintext, keyHash, keyPrefix } = generateApiKey();
  const id = randomUUID();
  const now = new Date().toISOString();

  await apiKeyRepo.create({
    id,
    userId: caller.uid,
    keyHash,
    keyPrefix,
    label: parsed.data.label,
    createdAt: now,
  });

  return NextResponse.json({
    id,
    label: parsed.data.label,
    keyPrefix,
    createdAt: now,
    plaintext,
  }, { status: 201 });
}

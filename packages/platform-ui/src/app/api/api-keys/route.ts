import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { generateApiKey } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

const MAX_ACTIVE_KEYS = 10;

const CreateBodySchema = z.object({
  label: z.string().min(1).max(128),
  userId: z.string().min(1).optional(),
});

function resolveTargetUser(
  caller: { kind: 'apiKey' } | { kind: 'user'; uid: string },
  requestedUserId: string | undefined,
): { userId: string } | NextResponse {
  if (caller.kind === 'user') {
    return { userId: caller.uid };
  }
  if (!requestedUserId) {
    return NextResponse.json(
      { error: 'Global API key requires userId parameter' },
      { status: 400 },
    );
  }
  return { userId: requestedUserId };
}

export async function GET(request: Request): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;

  const url = new URL(request.url);
  const queryUserId = url.searchParams.get('userId') ?? undefined;
  const target = resolveTargetUser(caller, queryUserId);
  if (target instanceof NextResponse) return target;

  const keys = await apiKeyRepo.listByUser(target.userId);
  return NextResponse.json({
    keys: keys.map(({ keyHash: _, ...rest }) => rest),
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  const { namespaceRepo, apiKeyRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo, apiKeyRepo);
  if (caller instanceof NextResponse) return caller;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const target = resolveTargetUser(caller, parsed.data.userId);
  if (target instanceof NextResponse) return target;

  const existing = await apiKeyRepo.listByUser(target.userId);
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
    userId: target.userId,
    keyHash,
    keyPrefix,
    label: parsed.data.label,
    createdAt: now,
  });

  return NextResponse.json({
    id,
    userId: target.userId,
    label: parsed.data.label,
    keyPrefix,
    createdAt: now,
    plaintext,
  }, { status: 201 });
}

import { NextResponse } from 'next/server';
import { getAdminAuth } from '@mediforce/platform-infra';
import type { FirestoreNamespaceRepository, FirestoreApiKeyRepository } from '@mediforce/platform-infra';
import { hashApiKey } from '@mediforce/platform-infra';

export type CallerIdentity =
  | { kind: 'apiKey' }
  | { kind: 'user'; uid: string; namespaces: Set<string> };

const LAST_USED_DEBOUNCE_MS = 60 * 60 * 1000; // 1 hour
const lastUsedCache = new Map<string, number>();

export async function resolveCallerIdentity(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
  apiKeyRepo: FirestoreApiKeyRepository,
): Promise<CallerIdentity | NextResponse> {
  const apiKeyHeader = request.headers.get('X-Api-Key');
  const expectedKey = process.env.PLATFORM_API_KEY;

  if (expectedKey?.startsWith('mf_')) {
    console.error('[api-auth] PLATFORM_API_KEY must not start with mf_ — collides with per-user key prefix');
  }

  if (apiKeyHeader && expectedKey && apiKeyHeader === expectedKey) {
    return { kind: 'apiKey' };
  }

  if (apiKeyHeader && apiKeyHeader.startsWith('mf_')) {
    const keyHash = hashApiKey(apiKeyHeader);
    const storedKey = await apiKeyRepo.getByKeyHash(keyHash);
    if (!storedKey || storedKey.revokedAt) {
      return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
    }
    const now = Date.now();
    const lastTouch = lastUsedCache.get(storedKey.id) ?? 0;
    if (now - lastTouch > LAST_USED_DEBOUNCE_MS) {
      lastUsedCache.set(storedKey.id, now);
      void apiKeyRepo.touchLastUsed(storedKey.id).catch(() => {});
    }
    const namespaces = await namespaceRepo.getNamespacesByUser(storedKey.userId);
    return { kind: 'user', uid: storedKey.userId, namespaces: new Set(namespaces.map((ns) => ns.handle)) };
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: 'Unauthorized — invalid token' }, { status: 401 });
  }

  const namespaces = await namespaceRepo.getNamespacesByUser(uid);
  return { kind: 'user', uid, namespaces: new Set(namespaces.map((ns) => ns.handle)) };
}

export function callerCanAccess(caller: CallerIdentity, namespace: string): boolean {
  return caller.kind === 'apiKey' || caller.namespaces.has(namespace);
}

export function requireNamespaceAccess(
  caller: CallerIdentity,
  namespace: string | undefined,
): NextResponse | null {
  if (caller.kind === 'apiKey') return null;
  if (!namespace) {
    return NextResponse.json({ error: 'Resource has no namespace' }, { status: 403 });
  }
  if (caller.namespaces.has(namespace)) return null;
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

export function filterByNamespace<T extends { namespace?: string }>(
  caller: CallerIdentity,
  items: T[],
): T[] {
  if (caller.kind === 'apiKey') return items;
  return items.filter((item) => typeof item.namespace === 'string' && caller.namespaces.has(item.namespace));
}


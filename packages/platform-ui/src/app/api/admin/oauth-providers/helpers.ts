import { NextResponse } from 'next/server';
import {
  type FirestoreNamespaceRepository,
  getAdminAuth,
} from '@mediforce/platform-infra';
import {
  PublicOAuthProviderConfigSchema,
  type OAuthProviderConfig,
  type PublicOAuthProviderConfig,
} from '@mediforce/platform-core';

/** Gate for `/api/admin/oauth-providers/**`.
 *
 *  Accepts one of two paths (the middleware already enforced presence of
 *  *some* authentication before we get here):
 *
 *   1. `X-Api-Key` matching `PLATFORM_ADMIN_API_KEY` (set in env).
 *      Separate from `PLATFORM_API_KEY` on purpose — regular API-key
 *      holders must not reach admin mutations. When `PLATFORM_ADMIN_API_KEY`
 *      is unset this path is effectively disabled. Tracked by #218.
 *   2. A Firebase ID token whose uid has `owner` or `admin` role in the
 *      target namespace (checked against `namespaces/{ns}/members/{uid}`).
 *
 *  On failure returns a NextResponse (400 missing/invalid namespace, 401
 *  missing/invalid token, 403 insufficient role, 404 namespace unknown).
 *  On success returns the namespace handle. */
export async function requireAdminForNamespace(
  request: Request,
  namespaceRepo: FirestoreNamespaceRepository,
): Promise<string | NextResponse> {
  const handle = new URL(request.url).searchParams.get('namespace');
  if (handle === null || handle.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: namespace' },
      { status: 400 },
    );
  }
  const namespace = await namespaceRepo.getNamespace(handle);
  if (namespace === null) {
    return NextResponse.json(
      { error: `Namespace "${handle}" does not exist.` },
      { status: 404 },
    );
  }

  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  const providedKey = request.headers.get('X-Api-Key');
  if (
    typeof adminKey === 'string'
    && adminKey !== ''
    && providedKey !== null
    && providedKey === adminKey
  ) {
    return handle;
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (token === '') {
    return NextResponse.json(
      { error: 'Unauthorized — namespace admin role required' },
      { status: 401 },
    );
  }
  let callerUid: string;
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
  } catch {
    return NextResponse.json(
      { error: 'Unauthorized — invalid token' },
      { status: 401 },
    );
  }

  const member = await namespaceRepo.getMember(handle, callerUid);
  if (member === null || (member.role !== 'owner' && member.role !== 'admin')) {
    return NextResponse.json(
      { error: 'Forbidden — namespace admin role required' },
      { status: 403 },
    );
  }
  return handle;
}

/** Strip `clientSecret` from a provider record before it leaves the API
 *  surface. Destructure first to drop the secret (the strict public schema
 *  would reject the extra key), then re-parse through
 *  `PublicOAuthProviderConfigSchema` so the returned object is a verified
 *  subset — a regression that added a new secret-bearing field would fail
 *  parse in tests instead of silently leaking. */
export function toPublicProvider(provider: OAuthProviderConfig): PublicOAuthProviderConfig {
  const { clientSecret: _clientSecret, ...publicFields } = provider;
  return PublicOAuthProviderConfigSchema.parse(publicFields);
}

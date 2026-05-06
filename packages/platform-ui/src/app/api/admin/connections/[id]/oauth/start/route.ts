import { NextResponse } from 'next/server';
import { signState, generateNonce, generatePkcePair } from '@mediforce/agent-runtime';
import { getPlatformServices } from '@/lib/platform-services';
import { getOAuthStateSecret } from '@/lib/oauth-state-secret';
import { getConfiguredAppBaseUrl } from '@/lib/app-base-url';
import { requireAdminContextForNamespace } from '../../../helpers';

function buildCallbackUrl(request: Request, providerSlug: string): string {
  const origin = getConfiguredAppBaseUrl() ?? new URL(request.url).origin;
  return `${origin}/api/oauth/${encodeURIComponent(providerSlug)}/callback`;
}

function buildAuthorizeUrl(params: {
  base: string;
  clientId: string;
  scopes: string[];
  redirectUri: string;
  state: string;
  codeChallenge?: string;
}): string {
  const url = new URL(params.base);
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', params.scopes.join(' '));
  url.searchParams.set('state', params.state);
  url.searchParams.set('access_type', 'offline');
  if (params.codeChallenge !== undefined) {
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

/** Initiate the OAuth flow for a Connection. The returned `authorizeUrl`
 *  is the provider's user-consent screen; after consent the provider
 *  redirects to `/api/oauth/[provider]/callback` (the existing callback
 *  endpoint), which dispatches by `state.connectionId` vs `state.agentId`
 *  to write the resulting tokens into the right store. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: connectionId } = await params;
  const services = getPlatformServices();
  const ctx = await requireAdminContextForNamespace(request, services.namespaceRepo);
  if (ctx instanceof NextResponse) return ctx;
  const { namespace, callerUid } = ctx;

  const connection = await services.connectionRepo.getById(namespace, connectionId);
  if (connection === null) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }
  if (connection.auth.type !== 'oauth') {
    return NextResponse.json(
      { error: `Connection "${connectionId}" is not oauth-typed; cannot start OAuth flow` },
      { status: 400 },
    );
  }
  const providerId = connection.auth.providerId;

  const provider = await services.oauthProviderRepo.get(namespace, providerId);
  if (provider === null) {
    return NextResponse.json(
      {
        error:
          `OAuth provider "${providerId}" referenced by Connection "${connectionId}" ` +
          `is not configured in namespace "${namespace}"`,
      },
      { status: 404 },
    );
  }

  const platformSecret = getOAuthStateSecret();
  if (platformSecret === null) {
    return NextResponse.json(
      { error: 'OAUTH_STATE_SECRET (or PLATFORM_API_KEY fallback) is not configured' },
      { status: 500 },
    );
  }

  // Caller identity for the audit field: the admin context already
  // resolved this from the same request — Firebase uid when the caller
  // authed with a Bearer token, or null (PLATFORM_ADMIN_API_KEY path),
  // in which case we record a synthetic actor so the field is always
  // present and machine-recognizable.
  const connectedBy = callerUid ?? 'admin-api-key';

  const pkce = await generatePkcePair();
  const state = await signState(
    {
      namespace,
      connectionId,
      providerId,
      connectedBy,
      ts: Date.now(),
      nonce: generateNonce(),
      codeVerifier: pkce.codeVerifier,
    },
    platformSecret,
  );

  const authorizeUrl = buildAuthorizeUrl({
    base: provider.authorizeUrl,
    clientId: provider.clientId,
    scopes: provider.scopes,
    redirectUri: buildCallbackUrl(request, providerId),
    state,
    codeChallenge: pkce.codeChallenge,
  });

  return NextResponse.json({ authorizeUrl, state });
}

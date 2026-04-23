import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signState, generateNonce, generatePkcePair } from '@mediforce/agent-runtime';
import { getPlatformServices } from '@/lib/platform-services';
import { requireFirebaseUid, requireNamespaceFromQuery } from '../../_shared/auth';

const StartBodySchema = z.object({
  serverName: z.string().min(1),
});

/** Returns the redirect URL derived from the incoming request plus the
 *  platform-wide callback path. Provider OAuth Apps must register this
 *  URL verbatim. */
function buildCallbackUrl(request: Request, providerSlug: string): string {
  const origin = new URL(request.url).origin;
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
  // `access_type=offline` requests a refresh token from Google; GitHub
  // ignores the parameter. Harmless cross-provider default.
  url.searchParams.set('access_type', 'offline');
  if (params.codeChallenge !== undefined) {
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }
  return url.toString();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; provider: string }> },
): Promise<NextResponse> {
  const { id: agentId, provider: providerSlug } = await params;

  const uidOrResponse = await requireFirebaseUid(request);
  if (uidOrResponse instanceof NextResponse) return uidOrResponse;
  const uid = uidOrResponse;

  const namespaceOrResponse = await requireNamespaceFromQuery(request);
  if (namespaceOrResponse instanceof NextResponse) return namespaceOrResponse;
  const namespace = namespaceOrResponse;

  const body = await request.json().catch(() => null);
  const parsed = StartBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { serverName } = parsed.data;

  const services = getPlatformServices();

  const agent = await services.agentDefinitionRepo.getById(agentId);
  if (agent === null) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const binding = agent.mcpServers?.[serverName];
  if (binding === undefined) {
    return NextResponse.json(
      { error: `Agent has no MCP binding named "${serverName}"` },
      { status: 404 },
    );
  }
  if (binding.type !== 'http' || binding.auth?.type !== 'oauth') {
    return NextResponse.json(
      { error: `Binding "${serverName}" is not configured for OAuth` },
      { status: 400 },
    );
  }
  if (binding.auth.provider !== providerSlug) {
    return NextResponse.json(
      {
        error:
          `Binding "${serverName}" is configured for provider "${binding.auth.provider}", ` +
          `not "${providerSlug}"`,
      },
      { status: 400 },
    );
  }

  const provider = await services.oauthProviderRepo.get(namespace, providerSlug);
  if (provider === null) {
    return NextResponse.json(
      { error: `OAuth provider "${providerSlug}" is not configured in namespace "${namespace}"` },
      { status: 404 },
    );
  }

  const platformSecret = process.env.PLATFORM_API_KEY ?? '';
  if (platformSecret === '') {
    return NextResponse.json(
      { error: 'PLATFORM_API_KEY is not configured' },
      { status: 500 },
    );
  }

  const pkce = await generatePkcePair();

  const state = await signState(
    {
      namespace,
      agentId,
      serverName,
      providerId: providerSlug,
      connectedBy: uid,
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
    redirectUri: buildCallbackUrl(request, providerSlug),
    state,
    codeChallenge: pkce.codeChallenge,
  });

  return NextResponse.json({ authorizeUrl, state });
}

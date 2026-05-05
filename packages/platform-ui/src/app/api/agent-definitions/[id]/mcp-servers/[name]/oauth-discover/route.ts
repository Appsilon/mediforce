import { NextResponse } from 'next/server';
import {
  discoverMcpAuthServer,
  deriveProviderSlug,
  McpDiscoveryError,
  registerOAuthClient,
  pickAuthMethod,
  DcrError,
} from '@mediforce/agent-runtime';
import {
  AgentMcpBindingSchema,
  type CreateOAuthProviderInput,
} from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

interface DiscoverBody {
  /** Namespace to scope the resulting provider doc. Required because
   *  providers live under `namespaces/{handle}/oauthProviders`. */
  namespace: string;
}

/** POST /api/agent-definitions/:id/mcp-servers/:name/oauth-discover
 *
 *  Given an existing HTTP binding on this agent, probe the URL for OAuth
 *  metadata, dynamically register a client with the discovered
 *  authorization server, persist the resulting provider under the
 *  requested namespace, and rewrite the binding's `auth` to point at it.
 *  After this runs successfully, `/api/agents/:id/oauth/:provider/start`
 *  will mint a consent URL using the DCR-registered credentials.
 *
 *  The endpoint is idempotent: re-running it re-registers the client and
 *  overwrites the provider doc. Use when rotating credentials or after
 *  provider deletion. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
): Promise<NextResponse> {
  const { id: agentId, name: serverName } = await params;

  const body = (await request.json().catch(() => null)) as DiscoverBody | null;
  if (body === null || typeof body.namespace !== 'string' || body.namespace === '') {
    return NextResponse.json(
      { error: 'JSON body with {namespace: string} is required' },
      { status: 400 },
    );
  }
  const { namespace } = body;

  const services = getPlatformServices();

  const agent = await services.agentDefinitionRepo.getById(agentId);
  if (agent === null) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  }

  const binding = agent.mcpServers?.[serverName];
  if (binding === undefined) {
    return NextResponse.json(
      { error: `Agent "${agentId}" has no MCP binding named "${serverName}"` },
      { status: 404 },
    );
  }
  if (binding.type !== 'http') {
    return NextResponse.json(
      { error: `Binding "${serverName}" is not an HTTP MCP; DCR only applies to HTTP transports` },
      { status: 400 },
    );
  }

  let discovered;
  try {
    discovered = await discoverMcpAuthServer(binding.url);
  } catch (err) {
    if (err instanceof McpDiscoveryError) {
      return NextResponse.json(
        { error: 'OAuth discovery failed', stage: err.stage, detail: err.message },
        { status: 502 },
      );
    }
    throw err;
  }

  const { resourceMetadata, authServer } = discovered;

  if (authServer.registration_endpoint === undefined) {
    return NextResponse.json(
      {
        error:
          `Authorization server at ${authServer.issuer} does not advertise a ` +
          `registration_endpoint — Dynamic Client Registration is not supported. ` +
          `Create an OAuth App manually and configure the provider via admin UI.`,
      },
      { status: 422 },
    );
  }

  const redirectUri = buildCallbackUrl(request, existingProviderSlug(binding, authServer.issuer));
  const providerSlug = existingProviderSlug(binding, authServer.issuer);
  const authMethod = pickAuthMethod(authServer.token_endpoint_auth_methods_supported);
  const scopes = chooseScopes(resourceMetadata.scopes_supported, authServer.scopes_supported);

  let registration;
  try {
    registration = await registerOAuthClient(authServer.registration_endpoint, {
      clientName: `Mediforce (${namespace}) — ${serverName}`,
      redirectUris: [redirectUri],
      scopes,
      tokenEndpointAuthMethod: authMethod,
    });
  } catch (err) {
    if (err instanceof DcrError) {
      return NextResponse.json(
        { error: 'Dynamic Client Registration failed', detail: err.detail },
        { status: 502 },
      );
    }
    throw err;
  }

  // The AS may downgrade/override the requested auth method — use whatever
  // it actually assigned so the callback handler speaks the right protocol.
  const actualAuthMethod = coerceAuthMethod(registration.token_endpoint_auth_method) ?? authMethod;

  const displayName = buildDisplayName(authServer.issuer, serverName);
  const providerInput: CreateOAuthProviderInput = {
    id: providerSlug,
    name: displayName,
    clientId: registration.client_id,
    ...(registration.client_secret !== undefined ? { clientSecret: registration.client_secret } : {}),
    authorizeUrl: authServer.authorization_endpoint,
    tokenUrl: authServer.token_endpoint,
    ...(authServer.revocation_endpoint !== undefined
      ? { revokeUrl: authServer.revocation_endpoint }
      : {}),
    ...(authServer.userinfo_endpoint !== undefined
      ? { userInfoUrl: authServer.userinfo_endpoint }
      : {}),
    scopes,
    tokenEndpointAuthMethod: actualAuthMethod,
    issuer: authServer.issuer,
    registrationEndpoint: authServer.registration_endpoint,
    resourceUrl: binding.url,
  };

  const existing = await services.oauthProviderRepo.get(namespace, providerSlug);
  if (existing === null) {
    await services.oauthProviderRepo.create(namespace, providerInput);
  } else {
    await services.oauthProviderRepo.update(namespace, providerSlug, providerInput);
  }

  // Rewrite the binding so the resolver picks up the new provider slug +
  // the default header shape expected by MCP bearer-token transports.
  const headerName = existingHeaderName(binding) ?? 'Authorization';
  const headerValueTemplate = existingHeaderValueTemplate(binding) ?? 'Bearer {token}';
  const updatedBinding = AgentMcpBindingSchema.parse({
    type: 'http',
    url: binding.url,
    ...(binding.allowedTools !== undefined ? { allowedTools: binding.allowedTools } : {}),
    auth: {
      type: 'oauth',
      provider: providerSlug,
      headerName,
      headerValueTemplate,
      ...(scopes.length > 0 ? { scopes } : {}),
    },
  });
  const nextMcpServers = { ...(agent.mcpServers ?? {}), [serverName]: updatedBinding };
  await services.agentDefinitionRepo.update(agentId, { mcpServers: nextMcpServers });

  return NextResponse.json(
    {
      provider: providerSlug,
      issuer: authServer.issuer,
      authorizeUrl: authServer.authorization_endpoint,
      tokenUrl: authServer.token_endpoint,
      registrationEndpoint: authServer.registration_endpoint,
      scopes,
      tokenEndpointAuthMethod: actualAuthMethod,
      clientId: registration.client_id,
      clientSecretPresent: registration.client_secret !== undefined,
      redirectUri,
      binding: updatedBinding,
    },
    { status: 200 },
  );
}

function existingProviderSlug(
  binding: { auth?: { type: string; provider?: string } },
  issuerUrl: string,
): string {
  if (
    binding.auth !== undefined &&
    binding.auth.type === 'oauth' &&
    typeof binding.auth.provider === 'string' &&
    binding.auth.provider.length > 0
  ) {
    return binding.auth.provider;
  }
  return deriveProviderSlug(issuerUrl);
}

function existingHeaderName(
  binding: { auth?: { type: string; headerName?: string } },
): string | undefined {
  if (binding.auth?.type === 'oauth' && typeof binding.auth.headerName === 'string') {
    return binding.auth.headerName;
  }
  return undefined;
}

function existingHeaderValueTemplate(
  binding: { auth?: { type: string; headerValueTemplate?: string } },
): string | undefined {
  if (binding.auth?.type === 'oauth' && typeof binding.auth.headerValueTemplate === 'string') {
    return binding.auth.headerValueTemplate;
  }
  return undefined;
}

function buildCallbackUrl(request: Request, providerSlug: string): string {
  const origin = new URL(request.url).origin;
  return `${origin}/api/oauth/${encodeURIComponent(providerSlug)}/callback`;
}

function buildDisplayName(issuerUrl: string, serverName: string): string {
  const host = new URL(issuerUrl).hostname;
  return `${serverName} (${host})`;
}

/** Union of resource + AS scopes, preserving resource order. At least one
 *  scope is required; fall back to 'openid' when neither advertises. */
function chooseScopes(
  resourceScopes: string[] | undefined,
  asScopes: string[] | undefined,
): string[] {
  const seen = new Set<string>();
  const picked: string[] = [];
  for (const s of resourceScopes ?? []) {
    if (!seen.has(s)) {
      seen.add(s);
      picked.push(s);
    }
  }
  for (const s of asScopes ?? []) {
    if (!seen.has(s)) {
      seen.add(s);
      picked.push(s);
    }
  }
  return picked.length > 0 ? picked : ['openid'];
}

function coerceAuthMethod(
  val: string | undefined,
): 'client_secret_basic' | 'client_secret_post' | 'none' | undefined {
  if (val === 'client_secret_basic' || val === 'client_secret_post' || val === 'none') {
    return val;
  }
  return undefined;
}

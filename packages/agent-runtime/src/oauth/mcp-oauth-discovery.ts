/** Shape of `.well-known/oauth-protected-resource/<resource>` (RFC 9728). */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
}

/** Subset of RFC 8414 OAuth authorization-server metadata we depend on. */
export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
}

/** Combined discovery output consumed by the DCR + provider-upsert path. */
export interface DiscoveredAuthServer {
  resourceUrl: string;
  resourceMetadata: ProtectedResourceMetadata;
  authServer: AuthServerMetadata;
}

export class McpDiscoveryError extends Error {
  public readonly stage: 'probe' | 'resource-metadata' | 'auth-server-metadata';
  constructor(stage: McpDiscoveryError['stage'], detail: string) {
    super(`MCP OAuth discovery failed at ${stage}: ${detail}`);
    this.name = 'McpDiscoveryError';
    this.stage = stage;
  }
}

/** Parse the `resource_metadata` hint from an RFC 9728 `WWW-Authenticate`
 *  challenge header. Returns null when absent or malformed. */
export function extractResourceMetadataUrl(wwwAuthenticate: string | null): string | null {
  if (wwwAuthenticate === null) return null;
  const match = /resource_metadata="([^"]+)"/i.exec(wwwAuthenticate);
  return match !== null ? match[1] : null;
}

/** Derive a stable provider slug from an issuer URL's hostname. Collapses
 *  `https://readwise.io/o/` → `readwise-io`. Unique enough within a namespace
 *  that two AS issuers on the same host share a slug only if they also share
 *  OAuth config — which is the intent. */
export function deriveProviderSlug(issuerUrl: string): string {
  const url = new URL(issuerUrl);
  const host = url.hostname.replace(/\.+/g, '-');
  return host.replace(/[^a-z0-9-]/gi, '').toLowerCase();
}

/** Probe the MCP resource URL, follow the `resource_metadata` hint (or fall
 *  back to the well-known path), then fetch AS metadata. Throws
 *  `McpDiscoveryError` with a stage marker on failure. */
export async function discoverMcpAuthServer(
  resourceUrl: string,
): Promise<DiscoveredAuthServer> {
  const probe = await probeResource(resourceUrl);
  const resourceMetadata = await fetchResourceMetadata(probe.resourceMetadataUrl);
  const authServer = await fetchAuthServerMetadata(resourceMetadata.authorization_servers[0]);
  return { resourceUrl, resourceMetadata, authServer };
}

async function probeResource(resourceUrl: string): Promise<{ resourceMetadataUrl: string }> {
  try {
    const res = await fetch(resourceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    const hint = extractResourceMetadataUrl(res.headers.get('WWW-Authenticate'));
    if (hint !== null) return { resourceMetadataUrl: hint };
    return { resourceMetadataUrl: wellKnownResourceMetadataUrl(resourceUrl) };
  } catch (err) {
    throw new McpDiscoveryError('probe', err instanceof Error ? err.message : String(err));
  }
}

function wellKnownResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  const path = url.pathname === '/' ? '' : url.pathname;
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

async function fetchResourceMetadata(metadataUrl: string): Promise<ProtectedResourceMetadata> {
  let res: Response;
  try {
    res = await fetch(metadataUrl, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new McpDiscoveryError('resource-metadata', err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    throw new McpDiscoveryError('resource-metadata', `HTTP ${res.status} from ${metadataUrl}`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (body === null) {
    throw new McpDiscoveryError('resource-metadata', `non-JSON body at ${metadataUrl}`);
  }
  const resource = body.resource;
  const authServers = body.authorization_servers;
  if (typeof resource !== 'string' || !Array.isArray(authServers) || authServers.length === 0) {
    throw new McpDiscoveryError('resource-metadata', `malformed metadata at ${metadataUrl}`);
  }
  const authServerUrls: string[] = [];
  for (const entry of authServers) {
    if (typeof entry === 'string') authServerUrls.push(entry);
  }
  if (authServerUrls.length === 0) {
    throw new McpDiscoveryError('resource-metadata', `no string entries in authorization_servers`);
  }
  return {
    resource,
    authorization_servers: authServerUrls,
    scopes_supported: arrayOfStrings(body.scopes_supported),
    bearer_methods_supported: arrayOfStrings(body.bearer_methods_supported),
  };
}

async function fetchAuthServerMetadata(issuerBase: string): Promise<AuthServerMetadata> {
  // Per RFC 8414: .well-known path is appended to the issuer URL.
  const base = issuerBase.replace(/\/+$/, '');
  const candidates = [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/.well-known/openid-configuration`,
  ];
  let lastDetail = '';
  for (const url of candidates) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Accept: 'application/json' } });
    } catch (err) {
      lastDetail = `fetch ${url}: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }
    if (!res.ok) {
      lastDetail = `HTTP ${res.status} from ${url}`;
      continue;
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (body === null) {
      lastDetail = `non-JSON body at ${url}`;
      continue;
    }
    const meta = extractAuthServerMetadata(body);
    if (meta !== null) return meta;
    lastDetail = `malformed AS metadata at ${url}`;
  }
  throw new McpDiscoveryError('auth-server-metadata', lastDetail || 'no usable metadata URL');
}

function extractAuthServerMetadata(body: Record<string, unknown>): AuthServerMetadata | null {
  const issuer = body.issuer;
  const authorize = body.authorization_endpoint;
  const tokenEndpoint = body.token_endpoint;
  if (typeof issuer !== 'string' || typeof authorize !== 'string' || typeof tokenEndpoint !== 'string') {
    return null;
  }
  return {
    issuer,
    authorization_endpoint: authorize,
    token_endpoint: tokenEndpoint,
    registration_endpoint: stringOrUndefined(body.registration_endpoint),
    revocation_endpoint: stringOrUndefined(body.revocation_endpoint),
    userinfo_endpoint: stringOrUndefined(body.userinfo_endpoint),
    scopes_supported: arrayOfStrings(body.scopes_supported),
    token_endpoint_auth_methods_supported: arrayOfStrings(body.token_endpoint_auth_methods_supported),
    code_challenge_methods_supported: arrayOfStrings(body.code_challenge_methods_supported),
    grant_types_supported: arrayOfStrings(body.grant_types_supported),
  };
}

function stringOrUndefined(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

function arrayOfStrings(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  const out: string[] = [];
  for (const entry of val) {
    if (typeof entry === 'string') out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

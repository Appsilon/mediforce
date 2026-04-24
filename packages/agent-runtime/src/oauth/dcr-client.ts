/** RFC 7591 Dynamic Client Registration response. `client_secret` is absent
 *  for public clients (`token_endpoint_auth_method: none` + PKCE). */
export interface DcrResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at?: number;
  client_secret_expires_at?: number;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  response_types?: string[];
  redirect_uris?: string[];
}

export interface DcrRequest {
  clientName: string;
  redirectUris: string[];
  scopes: string[];
  /** If the AS advertises multiple methods, caller picks one. We recommend
   *  'client_secret_basic' when it's supported; the AS may downgrade to
   *  'none' if the caller's choice isn't accepted. */
  tokenEndpointAuthMethod: 'client_secret_basic' | 'client_secret_post' | 'none';
}

export class DcrError extends Error {
  public readonly detail: string;
  constructor(detail: string) {
    super(`Dynamic Client Registration failed: ${detail}`);
    this.name = 'DcrError';
    this.detail = detail;
  }
}

/** POST the registration endpoint per RFC 7591. Returns the normalized
 *  response — throws `DcrError` on network or protocol failure. */
export async function registerOAuthClient(
  registrationEndpoint: string,
  req: DcrRequest,
): Promise<DcrResponse> {
  const body = {
    client_name: req.clientName,
    redirect_uris: req.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: req.tokenEndpointAuthMethod,
    scope: req.scopes.join(' '),
  };

  let res: Response;
  try {
    res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new DcrError(err instanceof Error ? err.message : String(err));
  }

  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const errText =
      json !== null && typeof json.error === 'string' ? json.error : `HTTP ${res.status}`;
    throw new DcrError(errText);
  }
  if (json === null || typeof json.client_id !== 'string') {
    throw new DcrError('registration response missing client_id');
  }
  const normalized: DcrResponse = { client_id: json.client_id };
  if (typeof json.client_secret === 'string') normalized.client_secret = json.client_secret;
  if (typeof json.client_id_issued_at === 'number')
    normalized.client_id_issued_at = json.client_id_issued_at;
  if (typeof json.client_secret_expires_at === 'number')
    normalized.client_secret_expires_at = json.client_secret_expires_at;
  if (typeof json.token_endpoint_auth_method === 'string')
    normalized.token_endpoint_auth_method = json.token_endpoint_auth_method;
  if (Array.isArray(json.grant_types))
    normalized.grant_types = json.grant_types.filter((s) => typeof s === 'string') as string[];
  if (Array.isArray(json.response_types))
    normalized.response_types = json.response_types.filter((s) => typeof s === 'string') as string[];
  if (Array.isArray(json.redirect_uris))
    normalized.redirect_uris = json.redirect_uris.filter((s) => typeof s === 'string') as string[];
  return normalized;
}

/** Pick the best `token_endpoint_auth_method` the AS supports. Preference:
 *  confidential client_secret_basic first (simpler), then client_secret_post,
 *  then public+PKCE. `undefined` means the AS didn't advertise — use the
 *  OAuth default (`client_secret_basic`). */
export function pickAuthMethod(
  supported: string[] | undefined,
): 'client_secret_basic' | 'client_secret_post' | 'none' {
  if (supported === undefined || supported.length === 0) return 'client_secret_basic';
  if (supported.includes('client_secret_basic')) return 'client_secret_basic';
  if (supported.includes('client_secret_post')) return 'client_secret_post';
  if (supported.includes('none')) return 'none';
  return 'client_secret_basic';
}

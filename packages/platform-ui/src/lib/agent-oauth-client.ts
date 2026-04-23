import { apiFetch } from './api-fetch';
import type { PublicAgentOAuthToken } from '@mediforce/platform-core';

/** Client-side helpers for the per-agent OAuth flow:
 *
 *  - `startOAuthFlow` posts to the "start" endpoint and returns the
 *    provider's authorize URL. UI performs `window.location = url` to
 *    full-page redirect.
 *  - `listAgentOAuthTokens` fetches the current connected state for every
 *    server on an agent (excludes access/refresh tokens — PublicAgentOAuthToken).
 *  - `disconnectOAuthToken` removes the stored token (+ optionally hits
 *    the provider revoke endpoint).
 */

async function parseOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${label} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface StartOAuthFlowResponse {
  /** Provider authorize URL. Caller does `window.location = url`. */
  authorizeUrl: string;
  /** State token, already embedded in authorizeUrl — surfaced for debugging. */
  state: string;
}

export async function startOAuthFlow(
  agentId: string,
  provider: string,
  serverName: string,
): Promise<StartOAuthFlowResponse> {
  const res = await apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/oauth/${encodeURIComponent(provider)}/start`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serverName }),
    },
  );
  return parseOrThrow<StartOAuthFlowResponse>(res, 'Start OAuth flow');
}

export interface AgentOAuthTokenStatus extends PublicAgentOAuthToken {
  serverName: string;
}

export async function listAgentOAuthTokens(agentId: string): Promise<AgentOAuthTokenStatus[]> {
  const res = await apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/oauth`,
  );
  const { tokens } = await parseOrThrow<{ tokens: AgentOAuthTokenStatus[] }>(
    res,
    'List agent OAuth tokens',
  );
  return tokens;
}

export interface DisconnectOptions {
  /** When true, the server hits the provider's revoke endpoint after
   *  deleting the local token. Default: false (disconnect local only). */
  revokeAtProvider?: boolean;
}

export async function disconnectOAuthToken(
  agentId: string,
  provider: string,
  serverName: string,
  options: DisconnectOptions = {},
): Promise<void> {
  const revoke = options.revokeAtProvider === true ? 'true' : 'false';
  const res = await apiFetch(
    `/api/agents/${encodeURIComponent(agentId)}/oauth/${encodeURIComponent(provider)}` +
    `?serverName=${encodeURIComponent(serverName)}&revokeAtProvider=${revoke}`,
    { method: 'DELETE' },
  );
  await parseOrThrow<{ success: true }>(res, 'Disconnect OAuth token');
}

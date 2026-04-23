import type { AgentOAuthToken } from '../schemas/agent-oauth-token.js';

/** Namespace + agent + server-scoped token storage. Backing store:
 *  `namespaces/{namespace}/agentOAuthTokens/{agentId}__{serverName}` (single
 *  flat collection keyed by a composed id; agentId and serverName are both
 *  persisted as top-level fields for filtering). */
export interface AgentOAuthTokenRepository {
  /** Returns null when no token is persisted for this (agent, server). */
  get(namespace: string, agentId: string, serverName: string): Promise<AgentOAuthToken | null>;

  /** Insert-or-replace the token. Refresh flow uses this to swap in a new
   *  access token without touching `connectedAt`/`connectedBy`. Callers
   *  are responsible for preserving those fields on refresh. */
  put(
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void>;

  /** Delete the token. Returns whether a document was actually removed. */
  delete(namespace: string, agentId: string, serverName: string): Promise<boolean>;

  /** List every token for a given agent. Used by the agent editor to decorate
   *  binding rows with "connected as" state without N+1 calls. */
  listByAgent(namespace: string, agentId: string): Promise<
    Array<AgentOAuthToken & { serverName: string }>
  >;
}

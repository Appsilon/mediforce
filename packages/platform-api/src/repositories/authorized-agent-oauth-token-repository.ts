import type {
  AgentOAuthToken,
  AgentOAuthTokenRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped storage of per-agent OAuth tokens. Namespace is path
 * prefix on every method.
 */
export interface AuthorizedAgentOAuthTokenRepository {
  get(
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<AgentOAuthToken | null>;
  put(
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void>;
  delete(namespace: string, agentId: string, serverName: string): Promise<boolean>;
  listByAgent(
    namespace: string,
    agentId: string,
  ): Promise<Array<AgentOAuthToken & { serverName: string }>>;
}

export class AuthorizedAgentOAuthTokenRepositoryImpl
  extends AuthorizedRepository<AgentOAuthToken>
  implements AuthorizedAgentOAuthTokenRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentOAuthTokenRepository,
  ) {
    super(caller);
  }

  get = async (
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<AgentOAuthToken | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.get(namespace, agentId, serverName);
  };

  put = async (
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.put(namespace, agentId, serverName, token);
  };

  delete = async (
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<boolean> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.delete(namespace, agentId, serverName);
  };

  listByAgent = async (
    namespace: string,
    agentId: string,
  ): Promise<Array<AgentOAuthToken & { serverName: string }>> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.listByAgent(namespace, agentId);
  };
}

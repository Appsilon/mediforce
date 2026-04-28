import type { AgentOAuthTokenRepository } from '../repositories/agent-oauth-token-repository.js';
import type { AgentOAuthToken } from '../schemas/agent-oauth-token.js';

function keyOf(agentId: string, serverName: string): string {
  return `${agentId}::${serverName}`;
}

export class InMemoryAgentOAuthTokenRepository implements AgentOAuthTokenRepository {
  // namespace → composedKey → token
  private readonly store = new Map<string, Map<string, AgentOAuthToken>>();

  async get(namespace: string, agentId: string, serverName: string): Promise<AgentOAuthToken | null> {
    const entry = this.store.get(namespace)?.get(keyOf(agentId, serverName));
    return entry ? { ...entry } : null;
  }

  async put(
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void> {
    const scope = this.store.get(namespace) ?? new Map<string, AgentOAuthToken>();
    scope.set(keyOf(agentId, serverName), { ...token });
    this.store.set(namespace, scope);
  }

  async delete(namespace: string, agentId: string, serverName: string): Promise<boolean> {
    const scope = this.store.get(namespace);
    if (!scope) return false;
    return scope.delete(keyOf(agentId, serverName));
  }

  async listByAgent(
    namespace: string,
    agentId: string,
  ): Promise<Array<AgentOAuthToken & { serverName: string }>> {
    const scope = this.store.get(namespace);
    if (!scope) return [];
    const results: Array<AgentOAuthToken & { serverName: string }> = [];
    const prefix = `${agentId}::`;
    for (const [composedKey, persisted] of scope) {
      if (!composedKey.startsWith(prefix)) continue;
      const serverName = composedKey.slice(prefix.length);
      results.push({ ...persisted, serverName });
    }
    return results.sort((a, b) => a.serverName.localeCompare(b.serverName));
  }
}

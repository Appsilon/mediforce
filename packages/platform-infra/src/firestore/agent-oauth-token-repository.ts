import type { Firestore } from 'firebase-admin/firestore';
import {
  AgentOAuthTokenSchema,
  type AgentOAuthToken,
  type AgentOAuthTokenRepository,
} from '@mediforce/platform-core';

/** Firestore-backed AgentOAuthTokenRepository.
 *
 *  Path: namespaces/{namespace}/agentOAuthTokens/{agentId}__{serverName}
 *  The composed key uses a double underscore as separator (agentIds often
 *  contain single dashes). `agentId` + `serverName` are persisted as top-level
 *  fields so `listByAgent` can run a cheap `.where('agentId', '==', …)` query. */
export class FirestoreAgentOAuthTokenRepository implements AgentOAuthTokenRepository {
  constructor(private readonly db: Firestore) {}

  private col(namespace: string) {
    return this.db.collection('namespaces').doc(namespace).collection('agentOAuthTokens');
  }

  private docId(agentId: string, serverName: string): string {
    return `${agentId}__${serverName}`;
  }

  async get(
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<AgentOAuthToken | null> {
    const snap = await this.col(namespace).doc(this.docId(agentId, serverName)).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    // Strip top-level fields not part of the token schema.
    const { agentId: _agentId, serverName: _serverName, ...tokenFields } = data;
    return AgentOAuthTokenSchema.parse(tokenFields);
  }

  async put(
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void> {
    const parsed = AgentOAuthTokenSchema.parse(token);
    await this.col(namespace)
      .doc(this.docId(agentId, serverName))
      .set({ ...parsed, agentId, serverName });
  }

  async delete(
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<boolean> {
    const ref = this.col(namespace).doc(this.docId(agentId, serverName));
    const snap = await ref.get();
    if (!snap.exists) return false;
    await ref.delete();
    return true;
  }

  async listByAgent(
    namespace: string,
    agentId: string,
  ): Promise<Array<AgentOAuthToken & { serverName: string }>> {
    const snap = await this.col(namespace).where('agentId', '==', agentId).get();
    const results: Array<AgentOAuthToken & { serverName: string }> = snap.docs.map((d) => {
      const data = d.data();
      const { agentId: _agentId, serverName, ...tokenFields } = data;
      const token = AgentOAuthTokenSchema.parse(tokenFields);
      return { ...token, serverName: String(serverName) };
    });
    return results.sort((a, b) => a.serverName.localeCompare(b.serverName));
  }
}

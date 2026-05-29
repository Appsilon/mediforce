import { and, asc, eq } from 'drizzle-orm';
import {
  AgentOAuthTokenSchema,
  type AgentOAuthToken,
  type AgentOAuthTokenRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { agentOAuthTokens } from '../schema/agent-oauth-token';

/**
 * Postgres-backed AgentOAuthTokenRepository (ADR-0001, PLAN §1.2).
 * Workspace column carries today's namespace handle. Composite PK
 * (workspace, agent_id, server_name) preserves the
 * "one token per (agent, server)" invariant Firestore enforced via the
 * `${agentId}__${serverName}` composed doc id.
 *
 * `put` is insert-or-replace (mirrors Firestore `.set()`). The schema
 * tracks `connectedAt` / `connectedBy` from the caller — refresh flows
 * preserve them by reading the existing token first (existing behavior).
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write.
 */
export class PostgresAgentOAuthTokenRepository implements AgentOAuthTokenRepository {
  constructor(private readonly db: Database) {}

  async get(
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<AgentOAuthToken | null> {
    const rows = await this.db
      .select()
      .from(agentOAuthTokens)
      .where(
        and(
          eq(agentOAuthTokens.workspace, namespace),
          eq(agentOAuthTokens.agentId, agentId),
          eq(agentOAuthTokens.serverName, serverName),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? AgentOAuthTokenSchema.parse(toToken(row)) : null;
  }

  async put(
    namespace: string,
    agentId: string,
    serverName: string,
    token: AgentOAuthToken,
  ): Promise<void> {
    const parsed = AgentOAuthTokenSchema.parse(token);
    const values = {
      workspace: namespace,
      agentId,
      serverName,
      providerId: parsed.provider,
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: parsed.expiresAt ?? null,
      scope: parsed.scope,
      providerUserId: parsed.providerUserId,
      accountLogin: parsed.accountLogin,
      connectedAt: parsed.connectedAt,
      connectedBy: parsed.connectedBy,
    };
    await this.db
      .insert(agentOAuthTokens)
      .values(values)
      .onConflictDoUpdate({
        target: [
          agentOAuthTokens.workspace,
          agentOAuthTokens.agentId,
          agentOAuthTokens.serverName,
        ],
        set: {
          providerId: values.providerId,
          accessToken: values.accessToken,
          refreshToken: values.refreshToken,
          expiresAt: values.expiresAt,
          scope: values.scope,
          providerUserId: values.providerUserId,
          accountLogin: values.accountLogin,
          connectedAt: values.connectedAt,
          connectedBy: values.connectedBy,
          // updated_at handled by the set_updated_at trigger.
        },
      });
  }

  async delete(
    namespace: string,
    agentId: string,
    serverName: string,
  ): Promise<boolean> {
    const rows = await this.db
      .delete(agentOAuthTokens)
      .where(
        and(
          eq(agentOAuthTokens.workspace, namespace),
          eq(agentOAuthTokens.agentId, agentId),
          eq(agentOAuthTokens.serverName, serverName),
        ),
      )
      .returning({ serverName: agentOAuthTokens.serverName });
    return rows.length > 0;
  }

  async listByAgent(
    namespace: string,
    agentId: string,
  ): Promise<Array<AgentOAuthToken & { serverName: string }>> {
    const rows = await this.db
      .select()
      .from(agentOAuthTokens)
      .where(
        and(
          eq(agentOAuthTokens.workspace, namespace),
          eq(agentOAuthTokens.agentId, agentId),
        ),
      )
      .orderBy(asc(agentOAuthTokens.serverName));
    return rows.map((row) => {
      const token = AgentOAuthTokenSchema.parse(toToken(row));
      return { ...token, serverName: row.serverName };
    });
  }
}

function toToken(row: typeof agentOAuthTokens.$inferSelect): AgentOAuthToken {
  const out: Record<string, unknown> = {
    provider: row.providerId,
    accessToken: row.accessToken,
    scope: row.scope,
    providerUserId: row.providerUserId,
    accountLogin: row.accountLogin,
    connectedAt: row.connectedAt,
    connectedBy: row.connectedBy,
  };
  if (row.refreshToken !== null) out.refreshToken = row.refreshToken;
  if (row.expiresAt !== null) out.expiresAt = row.expiresAt;
  return out as AgentOAuthToken;
}

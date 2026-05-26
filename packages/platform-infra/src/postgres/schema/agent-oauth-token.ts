import { pgTable, text, bigint, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

/**
 * Namespace + agent + server-scoped OAuth token (PLAN-0001 §1.2).
 * Original Firestore path:
 *   namespaces/{handle}/agentOAuthTokens/{agentId}__{serverName}
 *
 * Composite PK (workspace, agent_id, server_name) preserves the
 * "one token per (agent, server) binding" invariant Firestore enforced
 * through the composed document id.
 *
 * No cross-table FK to `oauth_providers(workspace, id)` even though
 * `provider_id` is conceptually a foreign key. Reasons (same call as the
 * audit repo skipping `process_instance_id` FK):
 *   1. Firestore enforced no such constraint — adding one here could
 *      reject rows that import cleanly from the legacy backend.
 *   2. Forces a per-migration ordering between oauth_providers and
 *      agent_oauth_tokens; keeping each table independent in its own
 *      migration is simpler and matches today's storage semantics.
 *
 * `expires_at` is the Unix-ms epoch from the provider — stored as
 * `bigint` (mode 'number') to round-trip the `z.number().int().positive()`
 * domain type without a timestamp conversion. Numbers stay safe well past
 * 2_000_000-AD.
 */
export const agentOAuthTokens = pgTable(
  'agent_oauth_tokens',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    agentId: text('agent_id').notNull(),
    serverName: text('server_name').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: bigint('expires_at', { mode: 'number' }),
    scope: text('scope').notNull(),
    providerUserId: text('provider_user_id').notNull(),
    accountLogin: text('account_login').notNull(),
    connectedAt: bigint('connected_at', { mode: 'number' }).notNull(),
    connectedBy: text('connected_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.agentId, table.serverName] }),
  }),
);

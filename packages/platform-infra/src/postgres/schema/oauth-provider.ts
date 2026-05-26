import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace.js';

/**
 * Namespace-scoped OAuth provider config (PLAN-0001 §1.2).
 * Original Firestore path: namespaces/{handle}/oauthProviders/{id}.
 *
 * Composite PK (workspace, id) preserves the per-workspace id uniqueness
 * that Firestore enforced through the document path. The `id` is the slug
 * surfaced in URLs (see schema regex) — stable enough to use as the PK.
 *
 * Small primitive fields stay as columns; the variable-length `scopes`
 * array lives in `jsonb` since Postgres `text[]` round-trips awkwardly
 * through drizzle and the column is never queried by element.
 */
export const oauthProviders = pgTable(
  'oauth_providers',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    name: text('name').notNull(),
    clientId: text('client_id').notNull(),
    clientSecret: text('client_secret'),
    authorizeUrl: text('authorize_url').notNull(),
    tokenUrl: text('token_url').notNull(),
    revokeUrl: text('revoke_url'),
    userInfoUrl: text('user_info_url'),
    scopes: jsonb('scopes').notNull().$type<string[]>(),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    issuer: text('issuer'),
    registrationEndpoint: text('registration_endpoint'),
    resourceUrl: text('resource_url'),
    iconUrl: text('icon_url'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.id] }),
  }),
);

import { and, eq } from 'drizzle-orm';
import {
  OAuthProviderConfigSchema,
  ProviderAlreadyExistsError,
  type CreateOAuthProviderInput,
  type OAuthProviderConfig,
  type OAuthProviderRepository,
  type UpdateOAuthProviderInput,
} from '@mediforce/platform-core';
import type { Database } from '../client.js';
import { oauthProviders } from '../schema/oauth-provider.js';

/**
 * Postgres-backed OAuthProviderRepository (ADR-0001 PR2, PLAN §1.2).
 * Workspace column carries today's namespace handle. Composite PK
 * (workspace, id) preserves the per-workspace id uniqueness Firestore
 * enforced through document paths.
 *
 * `createdAt` / `updatedAt` are managed by Postgres (column defaults +
 * the `oauth_providers_set_updated_at` trigger) so the repo never has to
 * compute them. The returned config converts both timestamps to ISO
 * strings to match the existing Firestore + in-memory backends.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write.
 */
export class PostgresOAuthProviderRepository implements OAuthProviderRepository {
  constructor(private readonly db: Database) {}

  async list(namespace: string): Promise<OAuthProviderConfig[]> {
    const rows = await this.db
      .select()
      .from(oauthProviders)
      .where(eq(oauthProviders.workspace, namespace));
    return rows
      .map((r) => OAuthProviderConfigSchema.parse(toConfig(r)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(namespace: string, id: string): Promise<OAuthProviderConfig | null> {
    const rows = await this.db
      .select()
      .from(oauthProviders)
      .where(
        and(
          eq(oauthProviders.workspace, namespace),
          eq(oauthProviders.id, id),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? OAuthProviderConfigSchema.parse(toConfig(row)) : null;
  }

  async create(
    namespace: string,
    input: CreateOAuthProviderInput,
  ): Promise<OAuthProviderConfig> {
    const existing = await this.db
      .select({ id: oauthProviders.id })
      .from(oauthProviders)
      .where(
        and(
          eq(oauthProviders.workspace, namespace),
          eq(oauthProviders.id, input.id),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new ProviderAlreadyExistsError(namespace, input.id);
    }
    const [row] = await this.db
      .insert(oauthProviders)
      .values({
        workspace: namespace,
        id: input.id,
        name: input.name,
        clientId: input.clientId,
        clientSecret: input.clientSecret ?? null,
        authorizeUrl: input.authorizeUrl,
        tokenUrl: input.tokenUrl,
        revokeUrl: input.revokeUrl ?? null,
        userInfoUrl: input.userInfoUrl ?? null,
        scopes: [...input.scopes],
        tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? null,
        issuer: input.issuer ?? null,
        registrationEndpoint: input.registrationEndpoint ?? null,
        resourceUrl: input.resourceUrl ?? null,
        iconUrl: input.iconUrl ?? null,
      })
      .returning();
    return OAuthProviderConfigSchema.parse(toConfig(row));
  }

  async update(
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null> {
    const current = await this.get(namespace, id);
    if (!current) return null;
    const merged: OAuthProviderConfig = OAuthProviderConfigSchema.parse({
      ...current,
      ...patch,
      // Keep id pinned — `update()` interface forbids changing it.
      id: current.id,
    });
    const [row] = await this.db
      .update(oauthProviders)
      .set({
        name: merged.name,
        clientId: merged.clientId,
        clientSecret: merged.clientSecret ?? null,
        authorizeUrl: merged.authorizeUrl,
        tokenUrl: merged.tokenUrl,
        revokeUrl: merged.revokeUrl ?? null,
        userInfoUrl: merged.userInfoUrl ?? null,
        scopes: [...merged.scopes],
        tokenEndpointAuthMethod: merged.tokenEndpointAuthMethod ?? null,
        issuer: merged.issuer ?? null,
        registrationEndpoint: merged.registrationEndpoint ?? null,
        resourceUrl: merged.resourceUrl ?? null,
        iconUrl: merged.iconUrl ?? null,
        // updated_at handled by the set_updated_at trigger.
      })
      .where(
        and(
          eq(oauthProviders.workspace, namespace),
          eq(oauthProviders.id, id),
        ),
      )
      .returning();
    return row ? OAuthProviderConfigSchema.parse(toConfig(row)) : null;
  }

  async delete(namespace: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(oauthProviders)
      .where(
        and(
          eq(oauthProviders.workspace, namespace),
          eq(oauthProviders.id, id),
        ),
      )
      .returning({ id: oauthProviders.id });
    return rows.length > 0;
  }
}

function toConfig(row: typeof oauthProviders.$inferSelect): OAuthProviderConfig {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    authorizeUrl: row.authorizeUrl,
    tokenUrl: row.tokenUrl,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.clientSecret !== null) out.clientSecret = row.clientSecret;
  if (row.revokeUrl !== null) out.revokeUrl = row.revokeUrl;
  if (row.userInfoUrl !== null) out.userInfoUrl = row.userInfoUrl;
  if (row.tokenEndpointAuthMethod !== null)
    out.tokenEndpointAuthMethod = row.tokenEndpointAuthMethod;
  if (row.issuer !== null) out.issuer = row.issuer;
  if (row.registrationEndpoint !== null)
    out.registrationEndpoint = row.registrationEndpoint;
  if (row.resourceUrl !== null) out.resourceUrl = row.resourceUrl;
  if (row.iconUrl !== null) out.iconUrl = row.iconUrl;
  return out as OAuthProviderConfig;
}

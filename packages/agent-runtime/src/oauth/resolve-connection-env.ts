import {
  connectionTokenEnvName,
  getValidToken,
  type ConnectionRepository,
  type GetValidTokenDeps,
  type OAuthProviderRepository,
} from '@mediforce/platform-core';

export interface ResolveConnectionEnvDeps {
  connectionRepo: ConnectionRepository;
  oauthProviderRepo: Pick<OAuthProviderRepository, 'get' | 'list'>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface ResolvedConnectionEnv {
  /** Env vars to inject into the consumer process. Always carries a
   *  `CONN_<NORMALIZED_ID>_TOKEN` per connection; provider `envAlias`
   *  entries are added when unambiguous within the step. */
  vars: Record<string, string>;
  /** Names of the env vars we wrote — for audit logging without value
   *  leaks. */
  injectedKeys: string[];
}

/** Thrown when a step references a Connection id that does not exist in
 *  the namespace. Surfaces as a step config error rather than running with
 *  half-injected env. */
export class StepConnectionMissingError extends Error {
  public readonly namespace: string;
  public readonly connectionId: string;
  constructor(namespace: string, connectionId: string) {
    super(
      `Step references Connection "${connectionId}" which does not exist in namespace "${namespace}"`,
    );
    this.name = 'StepConnectionMissingError';
    this.namespace = namespace;
    this.connectionId = connectionId;
  }
}

/** Thrown when two Connections referenced by the same step both resolve
 *  to the same `OAuthProvider.envAlias` — picking one would be silent and
 *  surprising, so we reject the step config. Admins must drop one of the
 *  Connections from the list (or split the work across two steps). */
export class StepConnectionAliasCollisionError extends Error {
  public readonly alias: string;
  public readonly connectionIds: string[];
  constructor(alias: string, connectionIds: string[]) {
    super(
      `Step connections collide on env alias "${alias}": ${connectionIds.join(
        ', ',
      )}. Drop one of the connections or split into separate steps.`,
    );
    this.name = 'StepConnectionAliasCollisionError';
    this.alias = alias;
    this.connectionIds = connectionIds;
  }
}

/** Resolve the env-var bundle for a step's `connections: string[]`.
 *
 *  For each connection id:
 *   - Loads the Connection via the repo (throws StepConnectionMissingError on miss).
 *   - For oauth-typed Connections: calls `getValidToken` to obtain a fresh
 *     access token (refreshing through the provider when expired).
 *   - For headers-typed Connections: skipped — header bags are consumed by
 *     HTTP MCP transports, not as a script env token. Headers values are
 *     not exported to env (they often carry templated `{{SECRET:...}}`
 *     refs that resolve only inside the MCP writer's render path).
 *
 *  Then collects `envAlias` entries from each Connection's OAuth provider.
 *  Aliases are emitted only when unambiguous within this step — if two
 *  Connections in the step share an alias, the helper throws rather than
 *  silently picking one. */
export async function resolveConnectionEnv(
  namespace: string,
  connectionIds: readonly string[],
  deps: ResolveConnectionEnvDeps,
): Promise<ResolvedConnectionEnv> {
  if (connectionIds.length === 0) {
    return { vars: {}, injectedKeys: [] };
  }

  // Phase 1 — resolve every connection's token serially through the lock.
  // (Parallel would be sound — each lock is per (ns, id) — but serial keeps
  //  step logs deterministic and the cost is negligible vs the spawn.)
  const tokens: Array<{
    connectionId: string;
    accessToken: string;
    providerId: string | null;
  }> = [];
  for (const connectionId of connectionIds) {
    const existing = await deps.connectionRepo.getById(namespace, connectionId);
    if (existing === null) {
      throw new StepConnectionMissingError(namespace, connectionId);
    }
    if (existing.auth.type !== 'oauth') {
      // Header-bag Connections are skipped at the env layer (they belong to
      // MCP HTTP transports). Still treat as resolved so the connection id
      // in the step's list does not silently lift the requirement.
      continue;
    }
    const tokenResolveDeps: GetValidTokenDeps = {
      connectionRepo: deps.connectionRepo,
      oauthProviderRepo: deps.oauthProviderRepo,
      ...(deps.fetchImpl !== undefined ? { fetchImpl: deps.fetchImpl } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    };
    const valid = await getValidToken(namespace, connectionId, tokenResolveDeps);
    tokens.push({
      connectionId,
      accessToken: valid.accessToken,
      providerId: valid.connection.auth.type === 'oauth' ? valid.connection.auth.providerId : null,
    });
  }

  // Phase 2 — collect alias entries per provider, detect collisions.
  // alias → list of contributing connection ids (preserves discovery order).
  // Memoize per providerId so two connections backed by the same provider
  // (the common `github × N` case) only hit Firestore once.
  const aliasContributors = new Map<string, string[]>();
  const providerCache = new Map<string, readonly string[]>();
  for (const t of tokens) {
    if (t.providerId === null) continue;
    let aliases = providerCache.get(t.providerId);
    if (aliases === undefined) {
      const provider = await deps.oauthProviderRepo.get(namespace, t.providerId);
      aliases = provider?.envAlias ?? [];
      providerCache.set(t.providerId, aliases);
    }
    for (const alias of aliases) {
      const existing = aliasContributors.get(alias) ?? [];
      existing.push(t.connectionId);
      aliasContributors.set(alias, existing);
    }
  }

  for (const [alias, contributors] of aliasContributors) {
    if (contributors.length > 1) {
      throw new StepConnectionAliasCollisionError(alias, contributors);
    }
  }

  // Phase 3 — render env. Always emit `CONN_<ID>_TOKEN`; emit aliases when
  // unambiguous (post-collision check).
  const vars: Record<string, string> = {};
  const injectedKeys: string[] = [];
  for (const t of tokens) {
    const tokenEnvName = connectionTokenEnvName(t.connectionId);
    vars[tokenEnvName] = t.accessToken;
    injectedKeys.push(tokenEnvName);
  }
  for (const [alias, contributors] of aliasContributors) {
    const onlyContributor = contributors[0];
    const tokenEntry = tokens.find((t) => t.connectionId === onlyContributor);
    if (tokenEntry !== undefined) {
      vars[alias] = tokenEntry.accessToken;
      injectedKeys.push(alias);
    }
  }

  return { vars, injectedKeys };
}

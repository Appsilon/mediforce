import {
  ConnectionAlreadyExistsError,
  ConnectionNotFoundError,
  ConnectionNotOAuthError,
  type ConnectionRepository,
} from '../interfaces/connection-repository.js';
import {
  type Connection,
  type ConnectionTokenUpdate,
  type CreateConnectionInput,
  type UpdateConnectionInput,
} from '../schemas/connection.js';

/** In-memory test double for ConnectionRepository. CRUD + setTokens only —
 *  no concurrency primitive. Concurrent token-refresh path lives in a
 *  follow-up PR alongside `runWithLock` and the full `getValidToken` impl. */
export class InMemoryConnectionRepository implements ConnectionRepository {
  // namespace → id → connection
  private readonly store = new Map<string, Map<string, Connection>>();
  private clock = 1_700_000_000_000;

  /** Override the deterministic clock used for createdAt/updatedAt/connectedAt. */
  setClock(ms: number): void {
    this.clock = ms;
  }

  private nextIso(): string {
    return new Date(this.clock++).toISOString();
  }

  private nextEpoch(): number {
    return this.clock++;
  }

  private scope(namespace: string): Map<string, Connection> {
    let scope = this.store.get(namespace);
    if (scope === undefined) {
      scope = new Map<string, Connection>();
      this.store.set(namespace, scope);
    }
    return scope;
  }

  async getById(namespace: string, id: string): Promise<Connection | null> {
    const entry = this.store.get(namespace)?.get(id);
    return entry ? structuredClone(entry) : null;
  }

  async list(namespace: string): Promise<Connection[]> {
    const scope = this.store.get(namespace);
    if (scope === undefined) return [];
    return [...scope.values()]
      .map((conn) => structuredClone(conn))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async create(namespace: string, input: CreateConnectionInput): Promise<Connection> {
    const scope = this.scope(namespace);
    if (scope.has(input.id)) {
      throw new ConnectionAlreadyExistsError(namespace, input.id);
    }
    const now = this.nextIso();
    const conn: Connection = { ...input, createdAt: now, updatedAt: now };
    scope.set(conn.id, conn);
    return structuredClone(conn);
  }

  async update(
    namespace: string,
    id: string,
    patch: UpdateConnectionInput,
  ): Promise<Connection | null> {
    const scope = this.store.get(namespace);
    const existing = scope?.get(id);
    if (existing === undefined || scope === undefined) return null;
    const updated: Connection = {
      ...existing,
      ...patch,
      // patch.auth replaces auth wholesale when provided; otherwise existing
      // auth wins. Spreading above already does this — explicit for clarity.
      auth: patch.auth ?? existing.auth,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: this.nextIso(),
    };
    scope.set(id, updated);
    return structuredClone(updated);
  }

  async delete(namespace: string, id: string): Promise<boolean> {
    const scope = this.store.get(namespace);
    if (scope === undefined) return false;
    return scope.delete(id);
  }

  async setTokens(
    namespace: string,
    id: string,
    tokens: ConnectionTokenUpdate,
  ): Promise<Connection> {
    const scope = this.store.get(namespace);
    const existing = scope?.get(id);
    if (existing === undefined || scope === undefined) {
      throw new ConnectionNotFoundError(namespace, id);
    }
    if (existing.auth.type !== 'oauth') {
      throw new ConnectionNotOAuthError(namespace, id);
    }
    const updated: Connection = {
      ...existing,
      auth: {
        ...existing.auth,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? existing.auth.refreshToken,
        expiresAt: tokens.expiresAt ?? existing.auth.expiresAt,
        scope: tokens.scope ?? existing.auth.scope,
        providerUserId: tokens.providerUserId ?? existing.auth.providerUserId,
        accountLogin: tokens.accountLogin ?? existing.auth.accountLogin,
        connectedBy: tokens.connectedBy ?? existing.auth.connectedBy,
        connectedAt: this.nextEpoch(),
      },
      updatedAt: this.nextIso(),
    };
    scope.set(id, updated);
    return structuredClone(updated);
  }

  /** Test helper: wipe all connections across namespaces. */
  clear(): void {
    this.store.clear();
  }
}

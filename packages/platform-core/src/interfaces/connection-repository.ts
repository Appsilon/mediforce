import type {
  Connection,
  ConnectionTokenUpdate,
  CreateConnectionInput,
  UpdateConnectionInput,
} from '../schemas/connection.js';

/** Namespace-scoped CRUD for Connections.
 *
 *  Backing store: `namespaces/{handle}/connections/{id}`.
 *
 *  A Connection represents a concrete authenticated endpoint (one OAuth
 *  account, or one set of static auth headers) that may be referenced by
 *  multiple ToolCatalogEntries and ScriptSteps. Token material lives
 *  inside `Connection.auth` for oauth connections and is rotated through
 *  `runWithLock` (see below) so that concurrent consumers see consistent
 *  values during refresh exchanges. */
export interface ConnectionRepository {
  /** Returns the Connection with the given id, or null when absent. */
  getById(namespace: string, id: string): Promise<Connection | null>;

  /** Returns every Connection in the namespace, sorted by id. */
  list(namespace: string): Promise<Connection[]>;

  /** Create a new Connection. Repo fills `createdAt`/`updatedAt`.
   *  Throws `ConnectionAlreadyExistsError` if `input.id` is taken. */
  create(namespace: string, input: CreateConnectionInput): Promise<Connection>;

  /** Patch an existing Connection. Returns null if the id is unknown.
   *  Refreshes `updatedAt`. Token material on `auth.oauth.*` should not
   *  be patched through this call — use `setTokens` so the audit trail
   *  (`connectedAt`, `connectedBy`) advances atomically. */
  update(
    namespace: string,
    id: string,
    patch: UpdateConnectionInput,
  ): Promise<Connection | null>;

  /** Delete a Connection. Returns true when a doc was actually removed. */
  delete(namespace: string, id: string): Promise<boolean>;

  /** Replace the OAuth token material on an oauth-typed Connection.
   *  Used by the OAuth callback (initial connect) and by token-refresh
   *  helpers. The repo also bumps `connectedAt`/`updatedAt`. Throws if
   *  the Connection is not oauth-typed. */
  setTokens(
    namespace: string,
    id: string,
    tokens: ConnectionTokenUpdate,
  ): Promise<Connection>;
}

/** Thrown by `create` when the chosen id already exists in the namespace. */
export class ConnectionAlreadyExistsError extends Error {
  public readonly namespace: string;
  public readonly id: string;
  constructor(namespace: string, id: string) {
    super(`Connection "${id}" already exists in namespace "${namespace}"`);
    this.name = 'ConnectionAlreadyExistsError';
    this.namespace = namespace;
    this.id = id;
  }
}

/** Thrown by `setTokens` when the target Connection is not oauth-typed. */
export class ConnectionNotOAuthError extends Error {
  public readonly namespace: string;
  public readonly id: string;
  constructor(namespace: string, id: string) {
    super(`Connection "${id}" in namespace "${namespace}" is not oauth-typed; cannot setTokens`);
    this.name = 'ConnectionNotOAuthError';
    this.namespace = namespace;
    this.id = id;
  }
}

/** Thrown by `setTokens` when the target Connection does not exist. */
export class ConnectionNotFoundError extends Error {
  public readonly namespace: string;
  public readonly id: string;
  constructor(namespace: string, id: string) {
    super(`Connection "${id}" not found in namespace "${namespace}"`);
    this.name = 'ConnectionNotFoundError';
    this.namespace = namespace;
    this.id = id;
  }
}

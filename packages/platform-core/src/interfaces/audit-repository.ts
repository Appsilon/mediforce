import type { AuditEvent } from '../schemas/audit-event';

/**
 * Options for `AuditRepository.getByNamespace`'s keyset-paginated read —
 * the Monitoring → Users / Tasks tabs' shared data source. All filters are
 * pushed here (not applied client-side after the fetch) so a 20-row page
 * reflects the true filtered set under the caller's current
 * user/action/date-range selections, not a client-side slice of an
 * arbitrary 20 rows that happened to load first.
 */
export interface GetByNamespaceOptions {
  /** Opaque keyset cursor from a previous page's `nextCursor` — omit for
   *  page 1. Malformed/unknown cursors are treated as "no cursor" (page 1). */
  cursor?: string;
  limit?: number;
  /** Restrict to these `action` values — e.g. Users tab passes the
   *  user-activity action set, Tasks tab the task-activity set, so LIMIT
   *  applies after narrowing to what that tab actually shows. */
  actions?: readonly string[];
  actorId?: string;
  /** Inclusive ISO date bounds (`YYYY-MM-DD`) on `timestamp`. */
  fromDate?: string;
  toDate?: string;
}

export interface GetByNamespacePage {
  readonly items: readonly AuditEvent[];
  readonly nextCursor?: string;
}

/**
 * Storage-layer authorization (ADR-0004): audit events have no namespace
 * field — they're scoped by the parent `ProcessInstance`. Implementations
 * resolve parent namespaces internally.
 */
export interface AuditRepository {
  append(event: Omit<AuditEvent, 'serverTimestamp'>): Promise<AuditEvent>;
  getByEntity(entityType: string, entityId: string): Promise<AuditEvent[]>;
  getByProcess(processInstanceId: string): Promise<AuditEvent[]>;
  /** Returns events only if the parent run's namespace is in `allowed`. */
  getByProcessInNamespaces(
    processInstanceId: string,
    allowed: readonly string[],
  ): Promise<AuditEvent[]>;
  getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]>;
  /** Every event whose resolved workspace is `namespace` — including
   *  parent-less events written with an explicit `namespace` hint (e.g.
   *  sign-ins). Newest first, keyset-paginated. See `GetByNamespaceOptions`. */
  getByNamespace(
    namespace: string,
    options?: GetByNamespaceOptions,
  ): Promise<GetByNamespacePage>;
}

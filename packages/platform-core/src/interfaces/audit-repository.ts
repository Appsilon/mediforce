import type { AuditEvent } from '../schemas/audit-event';

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
  getByProcessInNamespaces(processInstanceId: string, allowed: readonly string[]): Promise<AuditEvent[]>;
  getByActor(actorId: string, options?: { limit?: number }): Promise<AuditEvent[]>;
}

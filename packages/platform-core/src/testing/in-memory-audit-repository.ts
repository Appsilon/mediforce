import { AuditEventSchema, type AuditEvent } from '../schemas/audit-event';
import type { AuditRepository } from '../interfaces/audit-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';

/**
 * In-memory implementation of AuditRepository for testing.
 * Stores events in an array, simulates serverTimestamp with current time.
 *
 * Mirrors the Firestore + Postgres backends — every write parses through
 * Zod (parity with both real backends, ADR-0001 Implementation pattern 2).
 *
 * Namespace-scoped reads (`getByProcessInNamespaces`, `getByNamespace`)
 * resolve the parent run's namespace via the injected
 * `ProcessInstanceRepository`, mirroring PostgresAuditRepository's `workspace`
 * column — tracked alongside the stored event (not on the returned
 * `AuditEvent`, which carries no namespace field once written). Tests that
 * don't exercise a namespace-scoped path may omit the dep.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private records: Array<{ event: AuditEvent; workspace: string | undefined }> = [];

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    let workspace = event.namespace;
    if (workspace === undefined && typeof event.processInstanceId === 'string' && this.parents) {
      const parent = await this.parents.getById(event.processInstanceId);
      if (parent && typeof parent.namespace === 'string') {
        workspace = parent.namespace;
      }
    }

    // Strip the write-time-only `namespace` hint before storing so the
    // stored shape matches the Postgres read (workspace is derived state
    // there, not stored on the audit row). Parity with PostgresAuditRepository:
    // both backends accept `event.namespace` as the workspace-resolution
    // hint for workspace-scoped events that have no parent process run.
    const { namespace: _namespace, ...rest } = event;
    const completeEvent = AuditEventSchema.parse({
      ...rest,
      serverTimestamp: new Date().toISOString(),
    });

    this.records.push({ event: completeEvent, workspace });
    return completeEvent;
  }

  private get events(): AuditEvent[] {
    return this.records.map((r) => r.event);
  }

  async getByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.entityType === entityType && e.entityId === entityId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  async getByProcess(processInstanceId: string): Promise<AuditEvent[]> {
    return this.events
      .filter((e) => e.processInstanceId === processInstanceId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async getByProcessInNamespaces(
    processInstanceId: string,
    allowed: readonly string[],
  ): Promise<AuditEvent[]> {
    if (this.parents === undefined) {
      throw new Error(
        'InMemoryAuditRepository: ProcessInstanceRepository required for namespace-scoped methods',
      );
    }
    const parent = await this.parents.getById(processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByProcess(processInstanceId);
  }

  async getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]> {
    const filtered = this.events
      .filter((e) => e.actorId === actorId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (options?.limit) {
      return filtered.slice(0, options.limit);
    }

    return filtered;
  }

  async getByNamespace(
    namespace: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]> {
    const filtered = this.records
      .filter((r) => r.workspace === namespace)
      .map((r) => r.event)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    return options?.limit ? filtered.slice(0, options.limit) : filtered;
  }

  /** Test helper: get all stored events */
  getAll(): AuditEvent[] {
    return [...this.events];
  }

  /** Test helper: clear all stored events */
  clear(): void {
    this.records = [];
  }
}

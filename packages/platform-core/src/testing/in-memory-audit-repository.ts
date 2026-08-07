import { randomUUID } from 'node:crypto';
import { AuditEventSchema, type AuditEvent } from '../schemas/audit-event';
import type { AuditRepository, GetByNamespaceOptions, GetByNamespacePage } from '../interfaces/audit-repository';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository';
import { encodeAuditEventCursor, decodeAuditEventCursor } from '../cursors/audit-event-cursor';

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
    // A workspace-level event carries no parent run to derive the workspace
    // from, so `namespace` is the only source — and PostgresAuditRepository
    // throws without it (`audit_events.workspace` is NOT NULL). Mirror that
    // here, or handlers that forget it pass their unit tests and 500 in
    // production. Events that name a parent run stay lenient: tests seed
    // deliberately orphaned events to assert they are filtered out.
    if (workspace === undefined && event.processInstanceId === undefined) {
      throw new Error(
        'InMemoryAuditRepository.append: cannot resolve workspace — ' +
          'a workspace-level event must carry `namespace`.',
      );
    }

    // Strip the write-time-only `namespace` hint before storing so the
    // stored shape matches the Postgres read (workspace is derived state
    // there, not stored on the audit row). Parity with PostgresAuditRepository:
    // both backends accept `event.namespace` as the workspace-resolution
    // hint for workspace-scoped events that have no parent process run.
    const { namespace: _namespace, ...rest } = event;
    const completeEvent = AuditEventSchema.parse({
      ...rest,
      id: rest.id ?? randomUUID(),
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
    options?: GetByNamespaceOptions,
  ): Promise<GetByNamespacePage> {
    let filtered = this.records
      .filter((r) => r.workspace === namespace)
      .map((r) => r.event);
    if (options?.actions !== undefined && options.actions.length > 0) {
      const actionSet = new Set(options.actions);
      filtered = filtered.filter((e) => actionSet.has(e.action));
    }
    if (options?.actorId !== undefined) {
      filtered = filtered.filter((e) => e.actorId === options.actorId);
    }
    if (options?.fromDate !== undefined) {
      const from = `${options.fromDate}T00:00:00.000Z`;
      filtered = filtered.filter((e) => e.timestamp >= from);
    }
    if (options?.toDate !== undefined) {
      const to = `${options.toDate}T23:59:59.999Z`;
      filtered = filtered.filter((e) => e.timestamp <= to);
    }

    filtered.sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? 1 : -1;
      const aId = a.id ?? '';
      const bId = b.id ?? '';
      return aId < bId ? 1 : aId > bId ? -1 : 0;
    });

    if (options?.cursor !== undefined) {
      const after = decodeAuditEventCursor(options.cursor);
      if (after !== null) {
        filtered = filtered.filter(
          (e) =>
            e.timestamp < after.timestamp
            || (e.timestamp === after.timestamp && (e.id ?? '') < after.id),
        );
      }
    }

    const limit = options?.limit ?? 20;
    const items = filtered.slice(0, limit);
    const last = items[items.length - 1];
    const hasMore = filtered.length > items.length;
    return {
      items,
      ...(hasMore && last !== undefined && last.id !== undefined
        ? { nextCursor: encodeAuditEventCursor(last.timestamp, last.id) }
        : {}),
    };
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

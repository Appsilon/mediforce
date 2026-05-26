import { AuditEventSchema, type AuditEvent } from '../schemas/audit-event.js';
import type { AuditRepository } from '../interfaces/audit-repository.js';
import type { ProcessInstanceRepository } from '../interfaces/process-instance-repository.js';

/**
 * In-memory implementation of AuditRepository for testing.
 * Stores events in an array, simulates serverTimestamp with current time.
 *
 * Mirrors the Firestore + Postgres backends — every write parses through
 * Zod (parity with both real backends, ADR-0001 Implementation pattern 2).
 *
 * Namespace-scoped read (`getByProcessInNamespaces`) resolves the parent
 * run's namespace via the injected `ProcessInstanceRepository`. Tests that
 * don't exercise that path may omit the dep.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private events: AuditEvent[] = [];

  constructor(private readonly parents?: ProcessInstanceRepository) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    const completeEvent = AuditEventSchema.parse({
      ...event,
      serverTimestamp: new Date().toISOString(),
    });

    this.events.push(completeEvent);
    return completeEvent;
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

  /** Test helper: get all stored events */
  getAll(): AuditEvent[] {
    return [...this.events];
  }

  /** Test helper: clear all stored events */
  clear(): void {
    this.events = [];
  }
}

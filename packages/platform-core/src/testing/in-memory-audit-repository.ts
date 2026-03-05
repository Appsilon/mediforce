import type { AuditRepository, AuditEvent } from '../index.js';

/**
 * In-memory implementation of AuditRepository for testing.
 * Stores events in an array, simulates serverTimestamp with current time.
 * Reusable by any package that needs test doubles for audit operations.
 */
export class InMemoryAuditRepository implements AuditRepository {
  private events: AuditEvent[] = [];

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    const completeEvent: AuditEvent = {
      ...event,
      serverTimestamp: new Date().toISOString(),
    };

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
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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

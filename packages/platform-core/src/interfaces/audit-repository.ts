import type { AuditEvent } from '../schemas/audit-event.js';

export interface AuditRepository {
  append(event: Omit<AuditEvent, 'serverTimestamp'>): Promise<AuditEvent>;
  getByEntity(entityType: string, entityId: string): Promise<AuditEvent[]>;
  getByProcess(processInstanceId: string): Promise<AuditEvent[]>;
  getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]>;
}

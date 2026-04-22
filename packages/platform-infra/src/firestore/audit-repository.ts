import type { AuditRepository, AuditEvent } from '@mediforce/platform-core';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore implementation of the AuditRepository interface.
 * Provides append-only audit event storage with ALCOA+ field preservation.
 */
export class FirestoreAuditRepository implements AuditRepository {
  private readonly collectionName = 'auditEvents';

  constructor(private readonly db: Firestore) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    const colRef = this.db.collection(this.collectionName);

    const docRef = await colRef.add({
      ...event,
      serverTimestamp: FieldValue.serverTimestamp(),
    });

    const snapshot = await docRef.get();
    const data = snapshot.data()!;

    return {
      ...event,
      serverTimestamp: data.serverTimestamp
        ? (data.serverTimestamp as Timestamp).toDate().toISOString()
        : new Date().toISOString(),
    };
  }

  async getByEntity(
    entityType: string,
    entityId: string,
  ): Promise<AuditEvent[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('entityType', '==', entityType)
      .where('entityId', '==', entityId)
      .orderBy('timestamp', 'desc')
      .get();
    return snapshot.docs.map((d) => this.docToAuditEvent(d.data()));
  }

  async getByProcess(processInstanceId: string): Promise<AuditEvent[]> {
    const snapshot = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', processInstanceId)
      .get();
    return snapshot.docs
      .map((d) => this.docToAuditEvent(d.data()))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]> {
    let q = this.db
      .collection(this.collectionName)
      .where('actorId', '==', actorId)
      .orderBy('timestamp', 'desc');
    if (options?.limit) {
      q = q.limit(options.limit);
    }
    const snapshot = await q.get();
    return snapshot.docs.map((d) => this.docToAuditEvent(d.data()));
  }

  private docToAuditEvent(
    data: Record<string, unknown>,
  ): AuditEvent {
    return {
      actorId: data.actorId as string,
      actorType: data.actorType as AuditEvent['actorType'],
      actorRole: data.actorRole as string,
      action: data.action as string,
      description: data.description as string,
      timestamp: data.timestamp as string,
      serverTimestamp: data.serverTimestamp
        ? (data.serverTimestamp as Timestamp).toDate().toISOString()
        : undefined,
      inputSnapshot: data.inputSnapshot as Record<string, unknown>,
      outputSnapshot: data.outputSnapshot as Record<string, unknown>,
      basis: data.basis as string,
      entityType: data.entityType as string,
      entityId: data.entityId as string,
      processInstanceId: data.processInstanceId as string | undefined,
      stepId: data.stepId as string | undefined,
      processDefinitionVersion:
        data.processDefinitionVersion as string | undefined,
    };
  }
}

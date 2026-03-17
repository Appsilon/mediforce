import type { AuditRepository, AuditEvent } from '@mediforce/platform-core';
import {
  collection,
  addDoc,
  query,
  where,
  getDocs,
  orderBy,
  limit as firestoreLimit,
  serverTimestamp,
  getDoc,
  doc,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';

/**
 * Firestore implementation of the AuditRepository interface.
 * Provides append-only audit event storage with ALCOA+ field preservation.
 *
 * Receives a Firestore instance via constructor injection —
 * never imports or creates Firebase instances globally.
 */
export class FirestoreAuditRepository implements AuditRepository {
  private readonly collectionName = 'auditEvents';

  constructor(private readonly db: Firestore) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    const colRef = collection(this.db, this.collectionName);

    const docRef = await addDoc(colRef, {
      ...event,
      serverTimestamp: serverTimestamp(),
    });

    // Re-read the document to get the server-populated serverTimestamp
    const snapshot = await getDoc(doc(this.db, this.collectionName, docRef.id));
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
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('entityType', '==', entityType),
      where('entityId', '==', entityId),
      orderBy('timestamp', 'desc'),
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => this.docToAuditEvent(d.data()));
  }

  async getByProcess(processInstanceId: string): Promise<AuditEvent[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('processInstanceId', '==', processInstanceId),
    );

    const snapshot = await getDocs(q);
    return snapshot.docs
      .map((d) => this.docToAuditEvent(d.data()))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async getByActor(
    actorId: string,
    options?: { limit?: number },
  ): Promise<AuditEvent[]> {
    const colRef = collection(this.db, this.collectionName);

    const q = options?.limit
      ? query(
          colRef,
          where('actorId', '==', actorId),
          orderBy('timestamp', 'desc'),
          firestoreLimit(options.limit),
        )
      : query(
          colRef,
          where('actorId', '==', actorId),
          orderBy('timestamp', 'desc'),
        );

    const snapshot = await getDocs(q);
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

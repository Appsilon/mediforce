import type {
  AuditRepository,
  AuditEvent,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore implementation of the AuditRepository interface.
 * Provides append-only audit event storage with ALCOA+ field preservation.
 */
export class FirestoreAuditRepository implements AuditRepository {
  private readonly collectionName = 'auditEvents';

  constructor(
    private readonly db: Firestore,
    private readonly parents: ProcessInstanceRepository,
  ) {}

  async append(
    event: Omit<AuditEvent, 'serverTimestamp'>,
  ): Promise<AuditEvent> {
    const colRef = this.db.collection(this.collectionName);

    // Real Firestore rejects undefined values with
    // "Cannot use undefined as a Firestore value". Optional fields on
    // AuditEvent (`processInstanceId`, `stepId`, ...) and on handlers'
    // `inputSnapshot` payloads (`args`, etc.) routinely arrive as
    // undefined when omitted; scrub them so the in-memory and Firestore
    // paths agree on representation. Null is preserved.
    //
    // Strip only the user-supplied event; FieldValue.serverTimestamp() is
    // a class-instance sentinel that the SDK recognises by identity. A
    // recursive strip that walks every object would rebuild the sentinel
    // as a plain object — Firestore would then write a regular Map and the
    // read-back `.toDate()` call would fail.
    const docRef = await colRef.add({
      ...(stripUndefined(event) as Record<string, unknown>),
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

  async getByProcessInNamespaces(
    processInstanceId: string,
    allowed: readonly string[],
  ): Promise<AuditEvent[]> {
    const parent = await this.parents.getById(processInstanceId);
    if (!parent || typeof parent.namespace !== 'string') return [];
    if (!allowed.includes(parent.namespace)) return [];
    return this.getByProcess(processInstanceId);
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

function stripUndefined(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value
      .map((v) => stripUndefined(v))
      .filter((v): v is unknown => v !== undefined);
  }
  // Only recurse into plain `{}` objects. Class instances (FieldValue,
  // Timestamp, Date, GeoPoint, ...) are SDK sentinels Firestore identifies
  // by identity; rebuilding them as plain objects breaks the write.
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const stripped = stripUndefined(v);
      if (stripped !== undefined) out[k] = stripped;
    }
    return out;
  }
  return value;
}

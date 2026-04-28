import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import {
  CoworkSessionSchema,
  type CoworkSession,
  type ConversationTurn,
  type CoworkSessionRepository,
} from '@mediforce/platform-core';

/**
 * Sanitize raw Firestore data before Zod parse.
 * LLMs sometimes return artifact as JSON string instead of object — fix on read.
 */
function sanitizeSessionData(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.artifact === 'string') {
    try {
      data.artifact = JSON.parse(data.artifact);
    } catch {
      data.artifact = null;
    }
  }
  if (Array.isArray(data.turns)) {
    for (const turn of data.turns) {
      const t = turn as Record<string, unknown>;
      if (typeof t.artifactDelta === 'string') {
        try {
          t.artifactDelta = JSON.parse(t.artifactDelta);
        } catch {
          t.artifactDelta = null;
        }
      }
    }
  }
  return data;
}

export class FirestoreCoworkSessionRepository implements CoworkSessionRepository {
  private readonly collectionName = 'coworkSessions';

  constructor(private readonly db: Firestore) {}

  async create(session: CoworkSession): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(session.id).set(session);
    return session;
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const snap = await this.db.collection(this.collectionName).doc(sessionId).get();
    if (!snap.exists) return null;
    return CoworkSessionSchema.parse(sanitizeSessionData(snap.data() as Record<string, unknown>));
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .orderBy('createdAt', 'asc')
      .get();
    return snap.docs.map((d) => CoworkSessionSchema.parse(sanitizeSessionData(d.data())));
  }

  async findMostRecentActive(instanceId: string): Promise<CoworkSession | null> {
    const snap = await this.db
      .collection(this.collectionName)
      .where('processInstanceId', '==', instanceId)
      .where('status', '==', 'active')
      .orderBy('createdAt', 'desc')
      .get();
    if (snap.empty) return null;
    return CoworkSessionSchema.parse(sanitizeSessionData(snap.docs[0].data()));
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      turns: FieldValue.arrayUnion(turn),
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async updateTurn(
    sessionId: string,
    turnId: string,
    patch: Partial<ConversationTurn>,
  ): Promise<CoworkSession> {
    // Firestore has no in-place array element update — read, modify, write whole array.
    const session = await this.getById(sessionId);
    if (!session) throw new Error(`CoworkSession not found: ${sessionId}`);
    const index = session.turns.findIndex((t) => t.id === turnId);
    if (index === -1) throw new Error(`Turn not found: ${turnId}`);
    const existing = session.turns[index];
    const merged = { ...existing, ...patch, id: existing.id, role: existing.role } as ConversationTurn;
    const updatedTurns: ConversationTurn[] = session.turns.map((t, i) => (i === index ? merged : t));
    await this.db.collection(this.collectionName).doc(sessionId).update({
      turns: updatedTurns,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      artifact,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const now = new Date().toISOString();
    await this.db.collection(this.collectionName).doc(sessionId).update({
      status: 'finalized',
      finalizedAt: now,
      artifact,
      updatedAt: now,
    });
    return (await this.getById(sessionId))!;
  }

  async abandon(sessionId: string): Promise<CoworkSession> {
    await this.db.collection(this.collectionName).doc(sessionId).update({
      status: 'abandoned',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }
}

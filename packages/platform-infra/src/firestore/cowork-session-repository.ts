import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  orderBy,
  arrayUnion,
  type Firestore,
} from 'firebase/firestore';
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
    const docRef = doc(this.db, this.collectionName, session.id);
    await setDoc(docRef, session);
    return session;
  }

  async getById(sessionId: string): Promise<CoworkSession | null> {
    const docRef = doc(this.db, this.collectionName, sessionId);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return CoworkSessionSchema.parse(sanitizeSessionData(snap.data()));
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('processInstanceId', '==', instanceId),
      orderBy('createdAt', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => CoworkSessionSchema.parse(sanitizeSessionData(d.data())));
  }

  async findMostRecentActive(instanceId: string): Promise<CoworkSession | null> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('processInstanceId', '==', instanceId),
      where('status', '==', 'active'),
      orderBy('createdAt', 'desc'),
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return CoworkSessionSchema.parse(sanitizeSessionData(snap.docs[0].data()));
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      turns: arrayUnion(turn),
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
    // role is the discriminant — patch cannot change it, and id stays fixed.
    const existing = session.turns[index];
    const merged = { ...existing, ...patch, id: existing.id, role: existing.role } as ConversationTurn;
    const updatedTurns: ConversationTurn[] = session.turns.map((t, i) => (i === index ? merged : t));
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      turns: updatedTurns,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async updateArtifact(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      artifact,
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }

  async finalize(sessionId: string, artifact: Record<string, unknown>): Promise<CoworkSession> {
    const now = new Date().toISOString();
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      status: 'finalized',
      finalizedAt: now,
      artifact,
      updatedAt: now,
    });
    return (await this.getById(sessionId))!;
  }

  async abandon(sessionId: string): Promise<CoworkSession> {
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      status: 'abandoned',
      updatedAt: new Date().toISOString(),
    });
    return (await this.getById(sessionId))!;
  }
}

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
    return CoworkSessionSchema.parse(snap.data());
  }

  async getByInstanceId(instanceId: string): Promise<CoworkSession[]> {
    const colRef = collection(this.db, this.collectionName);
    const q = query(
      colRef,
      where('instanceId', '==', instanceId),
      orderBy('createdAt', 'asc'),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => CoworkSessionSchema.parse(d.data()));
  }

  async addTurn(sessionId: string, turn: ConversationTurn): Promise<CoworkSession> {
    const docRef = doc(this.db, this.collectionName, sessionId);
    await updateDoc(docRef, {
      turns: arrayUnion(turn),
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

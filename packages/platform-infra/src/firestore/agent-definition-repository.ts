import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { getFirestoreDb } from '../config/firebase-init.js';
import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type CreateAgentDefinitionInput,
  type UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';

function toAgentDefinition(id: string, data: Record<string, unknown>): AgentDefinition {
  return AgentDefinitionSchema.parse({
    ...data,
    id,
    inputDescription: data.inputDescription ?? '',
    outputDescription: data.outputDescription ?? '',
    skillFileNames: data.skillFileNames ?? [],
    createdAt:
      data.createdAt instanceof Timestamp
        ? data.createdAt.toDate().toISOString()
        : String(data.createdAt),
    updatedAt:
      data.updatedAt instanceof Timestamp
        ? data.updatedAt.toDate().toISOString()
        : String(data.updatedAt),
  });
}

export class FirestoreAgentDefinitionRepository implements AgentDefinitionRepository {
  private get col() {
    return collection(getFirestoreDb(), 'agentDefinitions');
  }

  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const now = serverTimestamp();
    const ref = await addDoc(this.col, { ...input, createdAt: now, updatedAt: now });
    const snap = await getDoc(ref);
    return toAgentDefinition(ref.id, snap.data() as Record<string, unknown>);
  }

  async getById(id: string): Promise<AgentDefinition | null> {
    const snap = await getDoc(doc(this.col, id));
    if (!snap.exists()) return null;
    return toAgentDefinition(snap.id, snap.data());
  }

  async list(): Promise<AgentDefinition[]> {
    const snap = await getDocs(this.col);
    return snap.docs.map((d) => toAgentDefinition(d.id, d.data()));
  }

  async update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    const ref = doc(this.col, id);
    await updateDoc(ref, { ...input, updatedAt: serverTimestamp() });
    const snap = await getDoc(ref);
    return toAgentDefinition(snap.id, snap.data() as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await deleteDoc(doc(this.col, id));
  }
}

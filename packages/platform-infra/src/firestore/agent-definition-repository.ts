import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import {
  AgentDefinitionSchema,
  type AgentDefinition,
  type AgentDefinitionRepository,
  type CreateAgentDefinitionInput,
  type UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';

function toAgentDefinition(id: string, data: Record<string, unknown>): AgentDefinition {
  // Legacy rows wrote this field as `pluginId`; new rows write `runtimeId`.
  // Normalize on read so orphan rows with the old field still parse.
  const runtimeId =
    typeof data.runtimeId === 'string'
      ? data.runtimeId
      : typeof data.pluginId === 'string'
        ? data.pluginId
        : undefined;
  return AgentDefinitionSchema.parse({
    ...data,
    id,
    runtimeId,
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
  constructor(private readonly db: Firestore) {}

  private get col() {
    return this.db.collection('agentDefinitions');
  }

  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const now = FieldValue.serverTimestamp();
    const ref = await this.col.add({ ...input, createdAt: now, updatedAt: now });
    const snap = await ref.get();
    return toAgentDefinition(ref.id, snap.data() as Record<string, unknown>);
  }

  async getById(id: string): Promise<AgentDefinition | null> {
    const snap = await this.col.doc(id).get();
    if (!snap.exists) return null;
    return toAgentDefinition(snap.id, snap.data() as Record<string, unknown>);
  }

  async list(): Promise<AgentDefinition[]> {
    const snap = await this.col.get();
    return snap.docs.map((d) => toAgentDefinition(d.id, d.data()));
  }

  async update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    const ref = this.col.doc(id);
    await ref.update({ ...input, updatedAt: FieldValue.serverTimestamp() });
    const snap = await ref.get();
    return toAgentDefinition(snap.id, snap.data() as Record<string, unknown>);
  }

  async delete(id: string): Promise<void> {
    await this.col.doc(id).delete();
  }
}

import type {
  AgentDefinition,
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '../index.js';
import { AgentDefinitionSchema } from '../schemas/agent-definition.js';

/**
 * In-memory `AgentDefinitionRepository` for tests. Implements the full
 * interface — create / upsert / getById / list / update / delete — with
 * deterministic IDs (`agent-def-NNNN`) and a fixed default timestamp.
 *
 * IDs and timestamps in stored records mirror the Firestore implementation
 * (createdAt set once on create / first upsert, updatedAt refreshed on
 * every write).
 */
export class InMemoryAgentDefinitionRepository implements AgentDefinitionRepository {
  private readonly byId = new Map<string, AgentDefinition>();
  private counter = 0;
  private now: () => string;

  constructor(opts: { now?: () => string } = {}) {
    this.now = opts.now ?? (() => '2026-01-15T10:00:00Z');
  }

  private nextId(): string {
    this.counter += 1;
    return `agent-def-${String(this.counter).padStart(4, '0')}`;
  }

  async create(input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const id = this.nextId();
    const timestamp = this.now();
    const parsed = AgentDefinitionSchema.parse({
      ...input,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    this.byId.set(id, parsed);
    return parsed;
  }

  async upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> {
    const existing = this.byId.get(id);
    const timestamp = this.now();
    const parsed = AgentDefinitionSchema.parse({
      ...input,
      id,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    this.byId.set(id, parsed);
    return parsed;
  }

  async getById(id: string): Promise<AgentDefinition | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<AgentDefinition[]> {
    return [...this.byId.values()];
  }

  async update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> {
    const existing = this.byId.get(id);
    if (existing === undefined) {
      throw new Error(`Agent definition ${id} not found`);
    }
    const merged = AgentDefinitionSchema.parse({
      ...existing,
      ...input,
      id,
      updatedAt: this.now(),
    });
    this.byId.set(id, merged);
    return merged;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }
}

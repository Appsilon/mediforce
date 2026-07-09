import type {
  AgentDefinition,
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '../index';
import { AgentDefinitionSchema } from '../schemas/agent-definition';

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

  async getByIdVisibleTo(
    id: string,
    allowed: readonly string[],
  ): Promise<AgentDefinition | null> {
    const agent = this.byId.get(id);
    if (agent === undefined) return null;
    if (agent.visibility === 'public') return agent;
    if (typeof agent.namespace === 'string' && allowed.includes(agent.namespace)) {
      return agent;
    }
    return null;
  }

  async listAll(): Promise<AgentDefinition[]> {
    return [...this.byId.values()];
  }

  async listVisibleTo(allowed: readonly string[]): Promise<AgentDefinition[]> {
    return [...this.byId.values()].filter((agent) => {
      if (agent.visibility === 'public') return true;
      return typeof agent.namespace === 'string' && allowed.includes(agent.namespace);
    });
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

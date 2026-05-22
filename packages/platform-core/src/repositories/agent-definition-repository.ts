import type {
  AgentDefinition,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '../schemas/agent-definition.js';

export type { CreateAgentDefinitionInput, UpdateAgentDefinitionInput };

export interface AgentDefinitionRepository {
  create(input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  /** Create or replace a definition at a caller-specified deterministic
   *  id. Used by seed scripts and migrators so that references from
   *  wd.json files (step.agentId) stay stable across environments. */
  upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  getById(id: string): Promise<AgentDefinition | null>;
  /** Returns the agent if `visibility: 'public'` OR namespace is in `allowed`; null otherwise. */
  getByIdVisibleTo(id: string, allowed: readonly string[]): Promise<AgentDefinition | null>;
  listAll(): Promise<AgentDefinition[]>;
  /** Returns agents that are `visibility: 'public'` OR whose namespace is in `allowed`. */
  listVisibleTo(allowed: readonly string[]): Promise<AgentDefinition[]>;
  update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition>;
  delete(id: string): Promise<void>;
}

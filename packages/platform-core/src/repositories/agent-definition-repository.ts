import type { AgentDefinition } from '../schemas/agent-definition.js';

export type CreateAgentDefinitionInput = Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt'>;
export type UpdateAgentDefinitionInput = Partial<Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt'>>;

export interface AgentDefinitionRepository {
  create(input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  getById(id: string): Promise<AgentDefinition | null>;
  list(): Promise<AgentDefinition[]>;
  update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition>;
  delete(id: string): Promise<void>;
}

import type {
  AgentDefinition,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '../schemas/agent-definition.js';

export type { CreateAgentDefinitionInput, UpdateAgentDefinitionInput };

export interface AgentDefinitionRepository {
  create(input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  getById(id: string): Promise<AgentDefinition | null>;
  list(): Promise<AgentDefinition[]>;
  update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition>;
  delete(id: string): Promise<void>;
}

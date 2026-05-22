import type {
  AgentDefinition,
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { NotFoundError } from '../errors.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace + visibility-scoped view of `AgentDefinitionRepository`. Mirrors
 * workflow-definition rules: public agents are readable by every caller,
 * private agents only by callers in the agent's workspace. Agents without a
 * namespace are visible only when `visibility: 'public'`.
 */
export interface AuthorizedAgentDefinitionRepository {
  getById(id: string): Promise<AgentDefinition | null>;
  list(): Promise<AgentDefinition[]>;
  upsert(id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition>;
  update(id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition>;
  delete(id: string): Promise<void>;
}

export class AuthorizedAgentDefinitionRepositoryImpl
  extends AuthorizedRepository<AgentDefinition>
  implements AuthorizedAgentDefinitionRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentDefinitionRepository,
  ) {
    super(caller);
  }

  getById = async (id: string): Promise<AgentDefinition | null> => {
    const agent = await this.raw.getById(id);
    return agent !== null && this.canSeeAgent(agent) ? agent : null;
  };

  list = async (): Promise<AgentDefinition[]> => {
    const agents = await this.raw.list();
    if (this.caller.kind === 'apiKey') return agents;
    return agents.filter((agent) => this.canSeeAgent(agent));
  };

  upsert = async (id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> => {
    this.assertNamespaceWrite(input.namespace);
    return this.raw.upsert(id, input);
  };

  update = async (id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> => {
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    if (!this.canSeeAgent(existing) || !this.canMutateAgent(existing)) {
      throw new NotFoundError();
    }
    return this.raw.update(id, input);
  };

  delete = async (id: string): Promise<void> => {
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    if (!this.canMutateAgent(existing)) throw new NotFoundError();
    await this.raw.delete(id);
  };

  private canSeeAgent(agent: AgentDefinition): boolean {
    if (this.caller.kind === 'apiKey') return true;
    if (agent.visibility === 'public') return true;
    return typeof agent.namespace === 'string' && this.caller.namespaces.has(agent.namespace);
  }

  private canMutateAgent(agent: AgentDefinition): boolean {
    if (this.caller.kind === 'apiKey') return true;
    return typeof agent.namespace === 'string' && this.caller.namespaces.has(agent.namespace);
  }
}

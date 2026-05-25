import type {
  AgentDefinition,
  AgentDefinitionRepository,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { NotFoundError } from '../errors.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace + visibility-scoped view of `AgentDefinitionRepository`. Mirrors
 * workflow-definition rules: public agents are readable by every caller,
 * private agents only by callers in the agent's workspace. Reads route to
 * `listAll`/`getById` for system actors, `listVisibleTo`/`getByIdVisibleTo`
 * for user callers.
 */
export class AuthorizedAgentDefinitionRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentDefinitionRepository,
  ) {
    super(caller);
  }

  getById = async (id: string): Promise<AgentDefinition | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(id)
      : this.raw.getByIdVisibleTo(id, [...this.caller.namespaces]);

  list = async (): Promise<AgentDefinition[]> =>
    this.caller.isSystemActor
      ? this.raw.listAll()
      : this.raw.listVisibleTo([...this.caller.namespaces]);

  upsert = async (id: string, input: CreateAgentDefinitionInput): Promise<AgentDefinition> => {
    this.assertNamespaceWrite(input.namespace);
    return this.raw.upsert(id, input);
  };

  update = async (id: string, input: UpdateAgentDefinitionInput): Promise<AgentDefinition> => {
    // Mutations require workspace-write on the existing agent's namespace.
    // System actors bypass.
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    this.assertWriteOrThrowNotFound(existing.namespace);
    return this.raw.update(id, input);
  };

  delete = async (id: string): Promise<void> => {
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    this.assertWriteOrThrowNotFound(existing.namespace);
    await this.raw.delete(id);
  };

  /** Mutation-path anti-enumeration: convert ForbiddenError into NotFoundError
   *  so non-members can't probe existence of out-of-scope agents. */
  private assertWriteOrThrowNotFound(namespace: string | undefined): void {
    if (this.caller.isSystemActor) return;
    if (typeof namespace !== 'string' || !this.caller.namespaces.has(namespace)) {
      throw new NotFoundError();
    }
  }
}

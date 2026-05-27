import type {
  AgentDefinition,
  AgentDefinitionRepository,
  AgentMcpBindingMap,
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

  create = async (input: CreateAgentDefinitionInput): Promise<AgentDefinition> => {
    // Preserve the legacy inline-route contract: the namespace field is
    // optional and only gates when supplied. Namespace-less agents are
    // platform-global and historically have no caller-side check at create
    // time; tightening that is a separate decision (Phase 2.6 territory).
    if (typeof input.namespace === 'string') {
      this.assertNamespaceWrite(input.namespace);
    }
    return this.raw.create(input);
  };

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

  /**
   * MCP-binding writes follow the legacy `mcp-servers` route contract, which is
   * deliberately looser than `update`/`delete`: a namespace-less (platform-global)
   * agent carries no caller-side write gate, so members may manage tool bindings
   * on public platform agents. Namespaced agents still require workspace
   * membership, with anti-enum NotFound for non-members.
   */
  updateMcpServers = async (id: string, mcpServers: AgentMcpBindingMap): Promise<AgentDefinition> => {
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    if (
      !this.caller.isSystemActor &&
      typeof existing.namespace === 'string' &&
      !this.caller.namespaces.has(existing.namespace)
    ) {
      throw new NotFoundError();
    }
    return this.raw.update(id, { mcpServers });
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

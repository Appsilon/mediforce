import type {
  AgentDefinition,
  AgentDefinitionRepository,
  AgentMcpBindingMap,
  AgentVersion,
  CreateAgentDefinitionInput,
  UpdateAgentDefinitionInput,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { NotFoundError } from '../errors';
import { AuthorizedScope } from './authorized-repository';

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

  /**
   * `namespace` is a client-supplied *filter*, never a grant: `narrowToMemberships`
   * intersects it with what the caller may read, so a non-member asking for
   * someone else's workspace is left with the public agents alone rather than
   * that workspace's private roster.
   */
  list = async (namespace?: string): Promise<AgentDefinition[]> => {
    if (namespace !== undefined) return this.raw.listVisibleTo(this.narrowToMemberships([namespace]));
    return this.caller.isSystemActor
      ? this.raw.listAll()
      : this.raw.listVisibleTo([...this.caller.namespaces]);
  };

  create = async (input: CreateAgentDefinitionInput): Promise<AgentDefinition> => {
    // The namespace field is optional and only gates when supplied.
    // Namespace-less agents are platform-global and carry no caller-side check
    // at create time; tightening that is a separate decision.
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

  /** Throws ForbiddenError unless the caller may create agents in the
   *  namespace. Lets a handler refuse before validating the input. */
  assertCanCreateIn = (namespace: string): void => this.assertNamespaceWrite(namespace);

  /** The agent, when the caller may update it; NotFoundError otherwise, as
   *  `update` itself would throw. Lets a handler refuse before validating. */
  getForUpdate = async (id: string): Promise<AgentDefinition> => {
    const existing = await this.raw.getById(id);
    if (existing === null) throw new NotFoundError();
    this.assertWriteOrThrowNotFound(existing.namespace);
    return existing;
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

  /**
   * The agents holding Skill `(namespace, id)` — or any Skill of `namespace`
   * when `id` is omitted — from every namespace: a public Skill can be held by
   * other workspaces' agents. Visibility is applied in the storage query, so
   * only the agents the caller may read are loaded; the rest are counted, so a
   * guard can say how many holders there are without naming agents the caller
   * cannot see.
   */
  holdersOfSkill = async (
    namespace: string,
    id?: string,
  ): Promise<{ visible: AgentDefinition[]; hiddenCount: number }> =>
    this.raw.findSkillHolders(
      { namespace, id },
      this.caller.isSystemActor ? null : [...this.caller.namespaces],
    );

  private imageAudit: Promise<AgentDefinition[]> | null = null;

  /**
   * Every agent in the deployment, regardless of namespace or visibility —
   * mirrors `AuthorizedWorkflowDefinitionRepository.listGroupsForImageAudit`:
   * deleting a Docker image breaks whichever agent names it, in whatever
   * workspace, so the caller's own memberships cannot narrow the read. The
   * caller must redact what it reveals. Read once per scope/request, since
   * deleting a multi-tag catalog entry asks this once per tag.
   */
  listAllForImageAudit = async (): Promise<AgentDefinition[]> => {
    this.imageAudit ??= this.raw.listAll();
    return this.imageAudit;
  };

  /** The versions of an Agent the caller can see, newest first; `[]` when it is not visible (ADR-0029). */
  listVersions = async (id: string): Promise<AgentVersion[]> =>
    (await this.getById(id)) === null ? [] : this.raw.listVersions(id);

  /**
   * Records a version of the agent the caller just saved or is evaluating. The
   * gate is the one its write passed, on the stored agent: workspace
   * membership for a namespaced agent; none for a platform-global one, whose
   * MCP bindings members manage (`updateMcpServers`).
   */
  appendVersion = async (version: AgentVersion): Promise<AgentVersion> => {
    const agent = await this.raw.getById(version.agentId);
    if (agent === null) throw new NotFoundError();
    if (typeof agent.namespace === 'string') this.assertWriteOrThrowNotFound(agent.namespace);
    return this.raw.appendVersion(version);
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

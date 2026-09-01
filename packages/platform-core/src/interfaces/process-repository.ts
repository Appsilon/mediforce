import type { WorkflowAccess } from '../schemas/workflow-access';
import type { WorkflowDefinition } from '../schemas/workflow-definition';

export interface WorkflowDefinitionGroup {
  namespace: string;
  name: string;
  versions: WorkflowDefinition[];
  latestVersion: number;
  defaultVersion: number | null;
}

export interface WorkflowDefinitionListResult {
  definitions: WorkflowDefinitionGroup[];
}

export interface ProcessRepository {
  // ---------------------------------------------------------------------------
  // WorkflowDefinition methods (unified schema)
  // ---------------------------------------------------------------------------

  getWorkflowDefinition(namespace: string, name: string, version: number): Promise<WorkflowDefinition | null>;
  saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  /** List all workflow definitions, grouped by name (system-actor variant).
   *  @param includeArchived When false, archived documents are filtered out
   *  before schema validation runs. This is the right default for any
   *  user-facing listing: archived WDs are not runnable, and skipping
   *  them avoids spamming logs with safeParse failures on legacy data
   *  that nobody intends to fix. */
  listAllWorkflowDefinitions(includeArchived: boolean): Promise<WorkflowDefinitionListResult>;
  /** Namespace-scoped variant for ordinary user-facing lists. */
  listWorkflowDefinitionsInNamespaces(
    namespaces: readonly string[],
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult>;
  getLatestWorkflowVersion(namespace: string, name: string): Promise<number>;
  /**
   * Return every persisted version of `name` in `namespace`, ascending by
   * version. Returns an empty array when no versions exist (including for
   * unknown names). Includes archived versions so the version picker can
   * render the archived badge — callers that need to exclude archived
   * filter at the call site.
   */
  listWorkflowVersions(namespace: string, name: string): Promise<WorkflowDefinition[]>;
  getDefaultWorkflowVersion(namespace: string, name: string): Promise<number | null>;
  setDefaultWorkflowVersion(namespace: string, name: string, version: number): Promise<void>;

  setProcessArchived(name: string, namespace: string, archived: boolean): Promise<void>;
  setVersionArchived(namespace: string, name: string, version: number, archived: boolean): Promise<void>;

  setWorkflowVisibility(name: string, namespace: string, visibility: 'public' | 'private'): Promise<void>;

  /**
   * Who may run and who may edit `(namespace, name)` — ADR-0019's workflow
   * level. Answers `OPEN_WORKFLOW_ACCESS` for an unconfigured or unknown name:
   * absent access is "any workspace member", never a refusal.
   */
  getWorkflowAccess(namespace: string, name: string): Promise<WorkflowAccess>;
  /**
   * Replace both role lists in one write. Full replace, like every other role
   * write in the epic. Access that grants nothing is stored as no row, so
   * "open to every member" has one representation and the delete / transfer
   * cascades are this same call.
   */
  setWorkflowAccess(namespace: string, name: string, access: WorkflowAccess): Promise<void>;
  /**
   * Every configured workflow's access across `namespaces`, keyed
   * `"namespace:name"`. Workflows with no gate are simply absent — the map is
   * the exception list, not the roster.
   *
   * One read for a whole listing. The workspace home page renders a Start
   * button per card, and asking per card is the N+1 the `manualStartEnabled`
   * gate above already refused to be.
   */
  listWorkflowAccess(namespaces: readonly string[]): Promise<Map<string, WorkflowAccess>>;
  setWorkflowDeleted(namespace: string, name: string, deleted: boolean): Promise<void>;
  isWorkflowNameDeleted(namespace: string, name: string): Promise<boolean>;
  countInstancesByDefinitionName(namespace: string, name: string): Promise<number>;

  /**
   * Move all versions of a workflow definition from `sourceNamespace` to
   * `targetNamespace`. Takes both namespaces so the
   * `AuthorizedWorkflowDefinitionRepository` wrapper can gate on each (caller
   * must own source AND target).
   */
  transferWorkflowNamespace(
    sourceNamespace: string,
    name: string,
    targetNamespace: string,
  ): Promise<void>;
}

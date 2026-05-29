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
  /** Namespace + visibility-scoped variant. Returns groups whose latest
   *  version is `visibility: 'public'` OR whose namespace is in `allowed`. */
  listWorkflowDefinitionsVisibleTo(
    allowed: readonly string[],
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult>;
  getLatestWorkflowVersion(namespace: string, name: string): Promise<number>;
  getDefaultWorkflowVersion(namespace: string, name: string): Promise<number | null>;
  setDefaultWorkflowVersion(namespace: string, name: string, version: number): Promise<void>;

  setProcessArchived(name: string, namespace: string, archived: boolean): Promise<void>;
  setVersionArchived(namespace: string, name: string, version: number, archived: boolean): Promise<void>;

  setWorkflowVisibility(name: string, namespace: string, visibility: 'public' | 'private'): Promise<void>;
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

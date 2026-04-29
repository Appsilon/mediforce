import type { WorkflowDefinition } from '../schemas/workflow-definition.js';

export interface WorkflowDefinitionGroup {
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

  getWorkflowDefinition(name: string, version: number): Promise<WorkflowDefinition | null>;
  saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  listWorkflowDefinitions(): Promise<WorkflowDefinitionListResult>;
  getLatestWorkflowVersion(name: string): Promise<number>;
  /**
   * Returns the highest version of `name` whose definition belongs to
   * `namespace`, or 0 if none. The webhook router calls this to avoid
   * picking up a version from another tenant when two namespaces share a
   * workflow name.
   */
  getLatestWorkflowVersionInNamespace(name: string, namespace: string): Promise<number>;
  getDefaultWorkflowVersion(name: string): Promise<number | null>;
  setDefaultWorkflowVersion(name: string, version: number): Promise<void>;

  setProcessArchived(name: string, archived: boolean): Promise<void>;

  setWorkflowDeleted(name: string, deleted: boolean): Promise<void>;
  isWorkflowNameDeleted(name: string): Promise<boolean>;
  countInstancesByDefinitionName(name: string): Promise<number>;
}

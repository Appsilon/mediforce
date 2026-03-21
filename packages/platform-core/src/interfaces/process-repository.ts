import type { ZodError } from 'zod';
import type { ProcessDefinition } from '../schemas/process-definition.js';
import type { ProcessConfig } from '../schemas/process-config.js';
import type { WorkflowDefinition } from '../schemas/workflow-definition.js';

export interface InvalidDefinitionEntry {
  data: unknown;
  error: ZodError;
}

export interface DefinitionListResult {
  valid: ProcessDefinition[];
  invalid: InvalidDefinitionEntry[];
}

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
  // WorkflowDefinition methods (new unified schema)
  // ---------------------------------------------------------------------------

  getWorkflowDefinition(name: string, version: number): Promise<WorkflowDefinition | null>;
  saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void>;
  listWorkflowDefinitions(): Promise<WorkflowDefinitionListResult>;
  getLatestWorkflowVersion(name: string): Promise<number>;
  getDefaultWorkflowVersion(name: string): Promise<number | null>;
  setDefaultWorkflowVersion(name: string, version: number): Promise<void>;

  // ---------------------------------------------------------------------------
  // ProcessDefinition methods (legacy)
  // ---------------------------------------------------------------------------

  /** @deprecated Use getWorkflowDefinition instead */
  getProcessDefinition(
    name: string,
    version: string,
  ): Promise<ProcessDefinition | null>;

  /** @deprecated Use saveWorkflowDefinition instead */
  saveProcessDefinition(definition: ProcessDefinition): Promise<void>;

  /** @deprecated Use listWorkflowDefinitions instead */
  listProcessDefinitions(): Promise<DefinitionListResult>;

  /** @deprecated Use getWorkflowDefinition instead */
  getProcessConfig(
    processName: string,
    configName: string,
    configVersion: string,
  ): Promise<ProcessConfig | null>;

  /** @deprecated Use saveWorkflowDefinition instead */
  saveProcessConfig(config: ProcessConfig): Promise<void>;

  /** @deprecated */
  listProcessConfigs(processName: string): Promise<ProcessConfig[]>;

  setProcessArchived(name: string, archived: boolean): Promise<void>;

  /** @deprecated */
  setConfigArchived(processName: string, configName: string, configVersion: string, archived: boolean): Promise<void>;

  setDefinitionVersionArchived(name: string, version: string, archived: boolean): Promise<void>;

  setWorkflowDeleted(name: string, deleted: boolean): Promise<void>;
  isWorkflowNameDeleted(name: string): Promise<boolean>;
  countInstancesByDefinitionName(name: string): Promise<number>;
}

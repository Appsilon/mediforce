import type {
  ProcessRepository,
  ProcessDefinition,
  ProcessConfig,
  DefinitionListResult,
  WorkflowDefinitionListResult,
  WorkflowDefinitionGroup,
} from '../index.js';
import type { WorkflowDefinition } from '../schemas/workflow-definition.js';

/**
 * In-memory implementation of ProcessRepository for testing.
 * Uses Maps with composite keys ({name}:{version}) matching Firestore document IDs.
 * Reusable by any package that needs test doubles for process operations.
 */
export class InMemoryProcessRepository implements ProcessRepository {
  private definitions = new Map<string, ProcessDefinition>();
  private configs = new Map<string, ProcessConfig>();
  private workflowDefinitions = new Map<string, WorkflowDefinition>();
  private workflowDefaults = new Map<string, number>();

  private compositeKey(name: string, version: string): string {
    return `${name}:${version}`;
  }

  // ---------------------------------------------------------------------------
  // WorkflowDefinition methods (new unified schema)
  // ---------------------------------------------------------------------------

  async getWorkflowDefinition(name: string, version: number): Promise<WorkflowDefinition | null> {
    return this.workflowDefinitions.get(this.compositeKey(name, String(version))) ?? null;
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    this.workflowDefinitions.set(
      this.compositeKey(definition.name, String(definition.version)),
      definition,
    );
  }

  async listWorkflowDefinitions(): Promise<WorkflowDefinitionListResult> {
    const grouped = new Map<string, WorkflowDefinition[]>();
    for (const definition of this.workflowDefinitions.values()) {
      const existing = grouped.get(definition.name) ?? [];
      existing.push(definition);
      grouped.set(definition.name, existing);
    }
    const definitions: WorkflowDefinitionGroup[] = Array.from(grouped.entries()).map(
      ([name, versions]) => ({
        name,
        versions,
        latestVersion: Math.max(...versions.map((v) => v.version)),
        defaultVersion: this.workflowDefaults.get(name) ?? null,
      }),
    );
    return { definitions };
  }

  async getDefaultWorkflowVersion(name: string): Promise<number | null> {
    return this.workflowDefaults.get(name) ?? null;
  }

  async setDefaultWorkflowVersion(name: string, version: number): Promise<void> {
    this.workflowDefaults.set(name, version);
  }

  async getLatestWorkflowVersion(name: string): Promise<number> {
    let latest = 0;
    for (const definition of this.workflowDefinitions.values()) {
      if (definition.name === name && definition.version > latest) {
        latest = definition.version;
      }
    }
    return latest;
  }

  // ---------------------------------------------------------------------------
  // ProcessDefinition methods (legacy)
  // ---------------------------------------------------------------------------

  async getProcessDefinition(
    name: string,
    version: string,
  ): Promise<ProcessDefinition | null> {
    return this.definitions.get(this.compositeKey(name, version)) ?? null;
  }

  async saveProcessDefinition(definition: ProcessDefinition): Promise<void> {
    this.definitions.set(
      this.compositeKey(definition.name, definition.version),
      definition,
    );
  }

  async listProcessDefinitions(): Promise<DefinitionListResult> {
    return { valid: Array.from(this.definitions.values()), invalid: [] };
  }

  async getProcessConfig(
    processName: string,
    configName: string,
    configVersion: string,
  ): Promise<ProcessConfig | null> {
    return this.configs.get(`${processName}:${configName}:${configVersion}`) ?? null;
  }

  async saveProcessConfig(config: ProcessConfig): Promise<void> {
    this.configs.set(
      `${config.processName}:${config.configName}:${config.configVersion}`,
      config,
    );
  }

  async listProcessConfigs(processName: string): Promise<ProcessConfig[]> {
    return Array.from(this.configs.values()).filter(
      (c) => c.processName === processName,
    );
  }

  async setProcessArchived(name: string, archived: boolean): Promise<void> {
    for (const [key, def] of this.definitions) {
      if (def.name === name) {
        this.definitions.set(key, { ...def, metadata: { ...def.metadata, archived } });
      }
    }
  }

  async setConfigArchived(
    processName: string,
    configName: string,
    configVersion: string,
    archived: boolean,
  ): Promise<void> {
    const key = `${processName}:${configName}:${configVersion}`;
    const config = this.configs.get(key);
    if (config !== undefined) {
      this.configs.set(key, { ...config, archived });
    }
  }

  async setDefinitionVersionArchived(
    name: string,
    version: string,
    archived: boolean,
  ): Promise<void> {
    const key = this.compositeKey(name, version);
    const def = this.definitions.get(key);
    if (def !== undefined) {
      this.definitions.set(key, { ...def, archived });
    }
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.definitions.clear();
    this.configs.clear();
    this.workflowDefinitions.clear();
  }

  /** Test helper: get counts of stored items */
  count(): { definitions: number; configs: number; workflowDefinitions: number } {
    return {
      definitions: this.definitions.size,
      configs: this.configs.size,
      workflowDefinitions: this.workflowDefinitions.size,
    };
  }
}

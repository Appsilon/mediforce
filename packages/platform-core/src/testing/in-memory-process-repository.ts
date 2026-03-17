import type {
  ProcessRepository,
  ProcessDefinition,
  ProcessConfig,
  DefinitionListResult,
} from '../index.js';

/**
 * In-memory implementation of ProcessRepository for testing.
 * Uses Maps with composite keys ({name}:{version}) matching Firestore document IDs.
 * Reusable by any package that needs test doubles for process operations.
 */
export class InMemoryProcessRepository implements ProcessRepository {
  private definitions = new Map<string, ProcessDefinition>();
  private configs = new Map<string, ProcessConfig>();

  private compositeKey(name: string, version: string): string {
    return `${name}:${version}`;
  }

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
    // Mark all versions of a definition as archived/unarchived
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
    if (config) {
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
    if (def) {
      this.definitions.set(key, { ...def, archived });
    }
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.definitions.clear();
    this.configs.clear();
  }

  /** Test helper: get counts of stored items */
  count(): { definitions: number; configs: number } {
    return {
      definitions: this.definitions.size,
      configs: this.configs.size,
    };
  }
}

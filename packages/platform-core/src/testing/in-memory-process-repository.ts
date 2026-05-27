import type {
  ProcessRepository,
  WorkflowDefinitionListResult,
  WorkflowDefinitionGroup,
} from '../index.js';
import type { WorkflowDefinition } from '../schemas/workflow-definition.js';

/**
 * In-memory implementation of ProcessRepository for testing.
 * Uses Maps with composite keys ({namespace}:{name}:{version}) matching Firestore document IDs.
 * Reusable by any package that needs test doubles for process operations.
 */
export class InMemoryProcessRepository implements ProcessRepository {
  private workflowDefinitions = new Map<string, WorkflowDefinition>();
  private workflowDefaults = new Map<string, number>();

  private compositeKey(namespace: string, name: string, version: string): string {
    return `${namespace}:${name}:${version}`;
  }

  // ---------------------------------------------------------------------------
  // WorkflowDefinition methods (unified schema)
  // ---------------------------------------------------------------------------

  async getWorkflowDefinition(namespace: string, name: string, version: number): Promise<WorkflowDefinition | null> {
    return this.workflowDefinitions.get(this.compositeKey(namespace, name, String(version))) ?? null;
  }

  async saveWorkflowDefinition(definition: WorkflowDefinition): Promise<void> {
    const key = this.compositeKey(
      definition.namespace,
      definition.name,
      String(definition.version),
    );
    if (this.workflowDefinitions.has(key)) {
      // Mirror Firestore + Postgres semantics: versions are immutable.
      const err = new Error(
        `Workflow definition "${definition.name}" version "${definition.version}" already exists and cannot be overwritten. ` +
          `Create a new version to change the definition.`,
      );
      err.name = 'WorkflowDefinitionVersionAlreadyExistsError';
      throw err;
    }
    this.workflowDefinitions.set(key, definition);
  }

  async listAllWorkflowDefinitions(
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult> {
    return this.buildListResult(includeArchived, () => true);
  }

  async listWorkflowDefinitionsVisibleTo(
    allowed: readonly string[],
    includeArchived: boolean,
  ): Promise<WorkflowDefinitionListResult> {
    return this.buildListResult(includeArchived, (group) => {
      const latest = group.versions.find((v) => v.version === group.latestVersion);
      if (latest === undefined) return false;
      if (latest.visibility === 'public') return true;
      return allowed.includes(latest.namespace);
    });
  }

  private buildListResult(
    includeArchived: boolean,
    predicate: (group: WorkflowDefinitionGroup) => boolean,
  ): WorkflowDefinitionListResult {
    const grouped = new Map<string, WorkflowDefinition[]>();
    for (const definition of this.workflowDefinitions.values()) {
      if (!includeArchived && definition.archived === true) continue;
      const key = this.compositeKey(definition.namespace, definition.name, '');
      const existing = grouped.get(key) ?? [];
      existing.push(definition);
      grouped.set(key, existing);
    }
    const definitions: WorkflowDefinitionGroup[] = Array.from(grouped.entries())
      .map(([_key, versions]) => {
        const namespace = versions[0].namespace;
        const name = versions[0].name;
        return {
          namespace,
          name,
          versions,
          latestVersion: Math.max(...versions.map((v) => v.version)),
          defaultVersion: this.workflowDefaults.get(`${namespace}:${name}`) ?? null,
        };
      })
      .filter(predicate);
    return { definitions };
  }

  async getDefaultWorkflowVersion(namespace: string, name: string): Promise<number | null> {
    return this.workflowDefaults.get(`${namespace}:${name}`) ?? null;
  }

  async setDefaultWorkflowVersion(namespace: string, name: string, version: number): Promise<void> {
    this.workflowDefaults.set(`${namespace}:${name}`, version);
  }

  async getLatestWorkflowVersion(namespace: string, name: string): Promise<number> {
    let latest = 0;
    for (const definition of this.workflowDefinitions.values()) {
      if (
        definition.name === name &&
        definition.namespace === namespace &&
        definition.version > latest
      ) {
        latest = definition.version;
      }
    }
    return latest;
  }

  async setProcessArchived(name: string, namespace: string, archived: boolean): Promise<void> {
    for (const [key, def] of this.workflowDefinitions) {
      if (def.name === name && def.namespace === namespace) {
        this.workflowDefinitions.set(key, { ...def, archived });
      }
    }
  }

  async setVersionArchived(namespace: string, name: string, version: number, archived: boolean): Promise<void> {
    const key = this.compositeKey(namespace, name, String(version));
    const def = this.workflowDefinitions.get(key);
    if (!def) {
      const err = new Error(`Workflow definition "${name}" version ${version} not found`);
      err.name = 'WorkflowDefinitionVersionNotFoundError';
      throw err;
    }
    this.workflowDefinitions.set(key, { ...def, archived });
  }

  async setWorkflowVisibility(name: string, namespace: string, visibility: 'public' | 'private'): Promise<void> {
    let found = false;
    for (const [key, def] of this.workflowDefinitions) {
      if (def.name === name && def.namespace === namespace) {
        this.workflowDefinitions.set(key, { ...def, visibility });
        found = true;
      }
    }
    if (!found) throw new Error(`Workflow '${name}' not found`);
  }

  async setWorkflowDeleted(namespace: string, name: string, deleted: boolean): Promise<void> {
    for (const [key, def] of this.workflowDefinitions) {
      if (def.name === name && def.namespace === namespace) {
        this.workflowDefinitions.set(key, { ...def, deleted });
      }
    }
  }

  async isWorkflowNameDeleted(namespace: string, name: string): Promise<boolean> {
    for (const definition of this.workflowDefinitions.values()) {
      if (definition.name === name && definition.namespace === namespace && definition.deleted === true) {
        return true;
      }
    }
    return false;
  }

  async countInstancesByDefinitionName(_namespace: string, _name: string): Promise<number> {
    return 0;
  }

  /** Test helper: clear all stored data */
  clear(): void {
    this.workflowDefinitions.clear();
  }

  /** Test helper: get counts of stored items */
  count(): { workflowDefinitions: number } {
    return {
      workflowDefinitions: this.workflowDefinitions.size,
    };
  }
}

import type {
  ProcessRepository,
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
  private workflowDefinitions = new Map<string, WorkflowDefinition>();
  private workflowDefaults = new Map<string, number>();

  private compositeKey(name: string, version: string): string {
    return `${name}:${version}`;
  }

  // ---------------------------------------------------------------------------
  // WorkflowDefinition methods (unified schema)
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

  async getLatestWorkflowVersionInNamespace(
    name: string,
    namespace: string,
  ): Promise<number> {
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

  async setProcessArchived(_name: string, _archived: boolean): Promise<void> {
    // No-op in test double
  }

  async setWorkflowDeleted(_name: string, _deleted: boolean): Promise<void> {
    // No-op in test double
  }

  async isWorkflowNameDeleted(_name: string): Promise<boolean> {
    return false;
  }

  async countInstancesByDefinitionName(_name: string): Promise<number> {
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

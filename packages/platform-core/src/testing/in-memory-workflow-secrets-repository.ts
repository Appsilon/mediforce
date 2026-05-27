import {
  WorkflowSecretsSchema,
  type WorkflowSecretsRepository,
} from '../index.js';

/**
 * In-memory WorkflowSecretsRepository for L2 parity tests.
 * Parses on every write (matching the Postgres + Firestore backends) so
 * shape violations surface here too.
 */
export class InMemoryWorkflowSecretsRepository implements WorkflowSecretsRepository {
  // namespace → workflowName → key → value
  private readonly store = new Map<string, Map<string, Map<string, string>>>();

  private workflowScope(namespace: string, workflowName: string): Map<string, string> | undefined {
    return this.store.get(namespace)?.get(workflowName);
  }

  async getSecrets(namespace: string, workflowName: string): Promise<Record<string, string>> {
    const scope = this.workflowScope(namespace, workflowName);
    return scope ? Object.fromEntries(scope.entries()) : {};
  }

  async getSecretKeys(namespace: string, workflowName: string): Promise<string[]> {
    const scope = this.workflowScope(namespace, workflowName);
    return scope ? Array.from(scope.keys()) : [];
  }

  async setSecrets(
    namespace: string,
    workflowName: string,
    secrets: Record<string, string>,
  ): Promise<void> {
    WorkflowSecretsSchema.parse({
      workflowName,
      namespace,
      secrets,
      updatedAt: new Date().toISOString(),
    });
    const ns = this.store.get(namespace) ?? new Map<string, Map<string, string>>();
    ns.set(workflowName, new Map(Object.entries(secrets)));
    this.store.set(namespace, ns);
  }

  async deleteSecrets(namespace: string, workflowName: string): Promise<void> {
    this.store.get(namespace)?.delete(workflowName);
  }

  async deleteSecret(namespace: string, workflowName: string, key: string): Promise<void> {
    this.workflowScope(namespace, workflowName)?.delete(key);
  }

  async upsertSecret(
    namespace: string,
    workflowName: string,
    key: string,
    value: string,
  ): Promise<void> {
    WorkflowSecretsSchema.parse({
      workflowName,
      namespace,
      secrets: { [key]: value },
      updatedAt: new Date().toISOString(),
    });
    const ns = this.store.get(namespace) ?? new Map<string, Map<string, string>>();
    const wf = ns.get(workflowName) ?? new Map<string, string>();
    wf.set(key, value);
    ns.set(workflowName, wf);
    this.store.set(namespace, ns);
  }
}

import type { CallerIdentity } from '../auth';
import type { NamespaceSecretsRepository, WorkflowSecretsRepository } from '@mediforce/platform-core';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped workspace secret access. Plaintext values flow through the
 * underlying repo's existing encryption; the wrapper only adds the membership
 * gate.
 */
export class AuthorizedWorkspaceSecretRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: NamespaceSecretsRepository,
    private readonly workflowSecrets: WorkflowSecretsRepository,
  ) {
    super(caller);
  }

  getSecrets = async (namespace: string): Promise<Record<string, string>> => {
    if (!this.canSeeNamespace(namespace)) return {};
    return this.raw.getSecrets(namespace);
  };

  /**
   * Merged workspace + workflow secrets for runtime use. Workflow values
   * override workspace values per existing convention. Single seam for the
   * "namespace defaults + workflow overrides" merge that every handler with
   * a runtime LLM/HTTP call needs.
   *
   * Returns `{}` for callers without namespace access (anti-enumeration —
   * matches `getSecrets`).
   */
  getRuntimeSecrets = async (namespace: string, workflowName: string): Promise<Record<string, string>> => {
    if (!this.canSeeNamespace(namespace)) return {};
    const [ns, wf] = await Promise.all([
      this.raw.getSecrets(namespace),
      this.workflowSecrets.getSecrets(namespace, workflowName),
    ]);
    return { ...ns, ...wf };
  };

  getSecretKeys = async (namespace: string): Promise<string[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.getSecretKeys(namespace);
  };

  setSecrets = async (namespace: string, secrets: Record<string, string>): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setSecrets(namespace, secrets);
  };

  upsertSecret = async (namespace: string, key: string, value: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.upsertSecret(namespace, key, value);
  };

  deleteSecret = async (namespace: string, key: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.deleteSecret(namespace, key);
  };
}

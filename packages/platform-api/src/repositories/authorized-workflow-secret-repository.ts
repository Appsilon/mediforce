import type { CallerIdentity } from '../auth.js';
import type { WorkflowSecretsRepository } from '@mediforce/platform-core';
import { AuthorizedScope } from './authorized-repository.js';

/** Workspace-scoped workflow secret access. Membership is on the workspace. */
export class AuthorizedWorkflowSecretRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: WorkflowSecretsRepository,
  ) {
    super(caller);
  }

  getSecrets = async (namespace: string, workflowName: string): Promise<Record<string, string>> => {
    if (!this.canSeeNamespace(namespace)) return {};
    return this.raw.getSecrets(namespace, workflowName);
  };

  getSecretKeys = async (namespace: string, workflowName: string): Promise<string[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.getSecretKeys(namespace, workflowName);
  };

  setSecrets = async (
    namespace: string,
    workflowName: string,
    secrets: Record<string, string>,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.setSecrets(namespace, workflowName, secrets);
  };

  deleteSecrets = async (namespace: string, workflowName: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.deleteSecrets(namespace, workflowName);
  };

  upsertSecret = async (
    namespace: string,
    workflowName: string,
    key: string,
    value: string,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.upsertSecret(namespace, workflowName, key, value);
  };
}

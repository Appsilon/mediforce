import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Minimal workflow-secret store the wrapper depends on. Declared structurally
 * so tests don't need to depend on `platform-infra`.
 */
export interface WorkflowSecretsRepositoryView {
  getSecrets(namespace: string, workflowName: string): Promise<Record<string, string>>;
  getSecretKeys(namespace: string, workflowName: string): Promise<string[]>;
  setSecrets(
    namespace: string,
    workflowName: string,
    secrets: Record<string, string>,
  ): Promise<void>;
  deleteSecrets(namespace: string, workflowName: string): Promise<void>;
  upsertSecret(
    namespace: string,
    workflowName: string,
    key: string,
    value: string,
  ): Promise<void>;
}

/** Workspace-scoped workflow secret access. Membership is on the workspace. */
export class AuthorizedWorkflowSecretRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: WorkflowSecretsRepositoryView,
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

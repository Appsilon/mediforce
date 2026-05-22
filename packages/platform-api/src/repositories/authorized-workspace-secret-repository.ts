import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Minimal namespace-secret store the wrapper depends on. Declared structurally
 * so tests can pass an in-memory map without depending on `platform-infra`.
 * The real `FirestoreNamespaceSecretsRepository` satisfies this shape.
 */
export interface NamespaceSecretsRepositoryView {
  getSecrets(namespace: string): Promise<Record<string, string>>;
  getSecretKeys(namespace: string): Promise<string[]>;
  setSecrets(namespace: string, secrets: Record<string, string>): Promise<void>;
  upsertSecret(namespace: string, key: string, value: string): Promise<void>;
  deleteSecret(namespace: string, key: string): Promise<void>;
}

/**
 * Workspace-scoped workspace secret access. Plaintext values flow through the
 * underlying repo's existing encryption; the wrapper only adds the membership
 * gate.
 */
export class AuthorizedWorkspaceSecretRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: NamespaceSecretsRepositoryView,
  ) {
    super(caller);
  }

  getSecrets = async (namespace: string): Promise<Record<string, string>> => {
    if (!this.canSeeNamespace(namespace)) return {};
    return this.raw.getSecrets(namespace);
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

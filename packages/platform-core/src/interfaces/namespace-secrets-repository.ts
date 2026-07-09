export interface NamespaceSecretsRepository {
  getSecrets(namespace: string): Promise<Record<string, string>>;
  getSecretKeys(namespace: string): Promise<string[]>;
  setSecrets(namespace: string, secrets: Record<string, string>): Promise<void>;
  upsertSecret(namespace: string, key: string, value: string): Promise<void>;
  deleteSecret(namespace: string, key: string): Promise<void>;
}

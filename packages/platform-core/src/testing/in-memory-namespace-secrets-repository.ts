import {
  NamespaceSecretsSchema,
  type NamespaceSecretsRepository,
} from '../index.js';

/**
 * In-memory NamespaceSecretsRepository for L2 parity tests.
 * Parses on every write (matching the Postgres + Firestore backends) so
 * shape violations surface here too.
 */
export class InMemoryNamespaceSecretsRepository implements NamespaceSecretsRepository {
  private readonly store = new Map<string, Map<string, string>>();

  async getSecrets(namespace: string): Promise<Record<string, string>> {
    const scope = this.store.get(namespace);
    if (!scope) return {};
    return Object.fromEntries(scope.entries());
  }

  async getSecretKeys(namespace: string): Promise<string[]> {
    const scope = this.store.get(namespace);
    return scope ? Array.from(scope.keys()) : [];
  }

  async setSecrets(namespace: string, secrets: Record<string, string>): Promise<void> {
    NamespaceSecretsSchema.parse({
      namespace,
      secrets,
      updatedAt: new Date().toISOString(),
    });
    this.store.set(namespace, new Map(Object.entries(secrets)));
  }

  async upsertSecret(namespace: string, key: string, value: string): Promise<void> {
    NamespaceSecretsSchema.parse({
      namespace,
      secrets: { [key]: value },
      updatedAt: new Date().toISOString(),
    });
    const scope = this.store.get(namespace) ?? new Map<string, string>();
    scope.set(key, value);
    this.store.set(namespace, scope);
  }

  async deleteSecret(namespace: string, key: string): Promise<void> {
    this.store.get(namespace)?.delete(key);
  }
}

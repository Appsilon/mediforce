import {
  ProviderAlreadyExistsError,
  type OAuthProviderRepository,
} from '../repositories/oauth-provider-repository.js';
import type {
  OAuthProviderConfig,
  CreateOAuthProviderInput,
  UpdateOAuthProviderInput,
} from '../schemas/oauth-provider.js';

export class InMemoryOAuthProviderRepository implements OAuthProviderRepository {
  // namespace → id → config
  private readonly store = new Map<string, Map<string, OAuthProviderConfig>>();
  // Monotonically increasing clock so tests can assert updatedAt advances
  // without dealing with real time.
  private clock = 1_700_000_000_000;

  /** Override the default clock for deterministic testing. */
  setClock(ms: number): void {
    this.clock = ms;
  }

  async list(namespace: string): Promise<OAuthProviderConfig[]> {
    const scope = this.store.get(namespace);
    if (!scope) return [];
    return Array.from(scope.values())
      .map((entry) => ({ ...entry }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(namespace: string, id: string): Promise<OAuthProviderConfig | null> {
    const entry = this.store.get(namespace)?.get(id);
    return entry ? { ...entry } : null;
  }

  async create(namespace: string, input: CreateOAuthProviderInput): Promise<OAuthProviderConfig> {
    const scope = this.store.get(namespace) ?? new Map<string, OAuthProviderConfig>();
    if (scope.has(input.id)) {
      throw new ProviderAlreadyExistsError(namespace, input.id);
    }
    const now = new Date(this.clock++).toISOString();
    const config: OAuthProviderConfig = { ...input, createdAt: now, updatedAt: now };
    scope.set(input.id, config);
    this.store.set(namespace, scope);
    return config;
  }

  async update(
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null> {
    const scope = this.store.get(namespace);
    const existing = scope?.get(id);
    if (!existing || !scope) return null;
    const updated: OAuthProviderConfig = {
      ...existing,
      ...patch,
      updatedAt: new Date(this.clock++).toISOString(),
    };
    scope.set(id, updated);
    return updated;
  }

  async delete(namespace: string, id: string): Promise<boolean> {
    const scope = this.store.get(namespace);
    if (!scope) return false;
    return scope.delete(id);
  }
}

import type {
  OAuthProviderConfig,
  CreateOAuthProviderInput,
  UpdateOAuthProviderInput,
} from '../schemas/oauth-provider.js';

/** Namespace-scoped CRUD for OAuth provider configs. Backing store:
 *  `namespaces/{namespace}/oauthProviders/{id}`. */
export interface OAuthProviderRepository {
  /** List every provider in the namespace. Sorted by id for stable order. */
  list(namespace: string): Promise<OAuthProviderConfig[]>;

  /** Returns null when the provider id does not exist. */
  get(namespace: string, id: string): Promise<OAuthProviderConfig | null>;

  /** Create a new provider. The repo sets `createdAt` and `updatedAt`.
   *  Throws `ProviderAlreadyExistsError` if `input.id` is taken. */
  create(namespace: string, input: CreateOAuthProviderInput): Promise<OAuthProviderConfig>;

  /** Patch an existing provider. Returns null if the id does not exist.
   *  Refreshes `updatedAt`. */
  update(
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null>;

  /** Delete a provider. No-op if the id does not exist. Returns whether
   *  a document was actually removed. */
  delete(namespace: string, id: string): Promise<boolean>;
}

export class ProviderAlreadyExistsError extends Error {
  public readonly namespace: string;
  public readonly id: string;
  constructor(namespace: string, id: string) {
    super(`OAuth provider "${id}" already exists in namespace "${namespace}"`);
    this.name = 'ProviderAlreadyExistsError';
    this.namespace = namespace;
    this.id = id;
  }
}

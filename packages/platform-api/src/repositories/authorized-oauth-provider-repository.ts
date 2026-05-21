import type {
  CreateOAuthProviderInput,
  OAuthProviderConfig,
  OAuthProviderRepository,
  UpdateOAuthProviderInput,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped OAuth provider configs. Namespace is path-prefix on every
 * method, so the wrapper asserts membership before delegating.
 */
export interface AuthorizedOAuthProviderRepository {
  list(namespace: string): Promise<OAuthProviderConfig[]>;
  get(namespace: string, id: string): Promise<OAuthProviderConfig | null>;
  create(namespace: string, input: CreateOAuthProviderInput): Promise<OAuthProviderConfig>;
  update(
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null>;
  delete(namespace: string, id: string): Promise<boolean>;
}

export class AuthorizedOAuthProviderRepositoryImpl
  extends AuthorizedRepository<OAuthProviderConfig>
  implements AuthorizedOAuthProviderRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: OAuthProviderRepository,
  ) {
    super(caller);
  }

  list = async (namespace: string): Promise<OAuthProviderConfig[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.list(namespace);
  };

  get = async (namespace: string, id: string): Promise<OAuthProviderConfig | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.get(namespace, id);
  };

  create = async (
    namespace: string,
    input: CreateOAuthProviderInput,
  ): Promise<OAuthProviderConfig> => {
    this.assertWrite(namespace);
    return this.raw.create(namespace, input);
  };

  update = async (
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null> => {
    this.assertWrite(namespace);
    return this.raw.update(namespace, id, patch);
  };

  delete = async (namespace: string, id: string): Promise<boolean> => {
    this.assertWrite(namespace);
    return this.raw.delete(namespace, id);
  };

  private assertWrite(namespace: string): void {
    if (this.caller.kind === 'apiKey') return;
    if (!this.caller.namespaces.has(namespace)) throw new ForbiddenError();
  }
}

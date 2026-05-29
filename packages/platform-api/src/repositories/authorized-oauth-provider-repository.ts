import type {
  CreateOAuthProviderInput,
  OAuthProviderConfig,
  OAuthProviderRepository,
  UpdateOAuthProviderInput,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped OAuth provider configs. Namespace is path-prefix on every
 * method, so the wrapper asserts membership before delegating.
 */
export class AuthorizedOAuthProviderRepository extends AuthorizedScope {
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
    this.assertNamespaceWrite(namespace);
    return this.raw.create(namespace, input);
  };

  update = async (
    namespace: string,
    id: string,
    patch: UpdateOAuthProviderInput,
  ): Promise<OAuthProviderConfig | null> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.update(namespace, id, patch);
  };

  delete = async (namespace: string, id: string): Promise<boolean> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.delete(namespace, id);
  };
}

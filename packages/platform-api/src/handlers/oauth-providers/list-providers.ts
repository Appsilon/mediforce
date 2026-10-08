import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListOAuthProvidersInput,
  ListOAuthProvidersOutput,
} from '../../contract/oauth-providers';
import { toPublicProvider } from './_helpers';

/** Any member lists providers so they can pick one for an HTTP MCP server
 *  (ADR-0026 §4). The public shape carries no `clientSecret`; creating and
 *  editing a provider stay admin-only. */
export async function listOAuthProviders(
  input: ListOAuthProvidersInput,
  scope: CallerScope,
): Promise<ListOAuthProvidersOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const providers = await scope.oauthProviders.list(input.namespace);
  return { providers: providers.map(toPublicProvider) };
}

import { assertCallerIsNamespaceAdmin } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type { ListOAuthProvidersInput, ListOAuthProvidersOutput } from '../../contract/oauth-providers';
import { toPublicProvider } from './_helpers';

export async function listOAuthProviders(
  input: ListOAuthProvidersInput,
  scope: CallerScope,
): Promise<ListOAuthProvidersOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const providers = await scope.oauthProviders.list(input.namespace);
  return { providers: providers.map(toPublicProvider) };
}

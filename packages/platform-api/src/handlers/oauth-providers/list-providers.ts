import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  ListOAuthProvidersInput,
  ListOAuthProvidersOutput,
} from '../../contract/oauth-providers.js';
import { toPublicProvider } from './_helpers.js';

export async function listOAuthProviders(
  input: ListOAuthProvidersInput,
  scope: CallerScope,
): Promise<ListOAuthProvidersOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const providers = await scope.oauthProviders.list(input.namespace);
  return { providers: providers.map(toPublicProvider) };
}

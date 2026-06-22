import { assertCallerIsNamespaceAdmin } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { GetOAuthProviderInput, GetOAuthProviderOutput } from '../../contract/oauth-providers';
import { toPublicProvider } from './_helpers';

export async function getOAuthProvider(
  input: GetOAuthProviderInput,
  scope: CallerScope,
): Promise<GetOAuthProviderOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const provider = await scope.oauthProviders.get(input.namespace, input.id);
  if (provider === null) {
    throw new NotFoundError(`OAuth provider '${input.id}' not found`);
  }
  return { provider: toPublicProvider(provider) };
}

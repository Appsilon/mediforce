import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type {
  GetOAuthProviderInput,
  GetOAuthProviderOutput,
} from '../../contract/oauth-providers.js';
import { toPublicProvider } from './_helpers.js';

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

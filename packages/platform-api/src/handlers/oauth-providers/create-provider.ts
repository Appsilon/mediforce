import { ProviderAlreadyExistsError } from '@mediforce/platform-core';
import { assertCallerIsNamespaceAdmin } from '../../auth';
import { HandlerError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  CreateOAuthProviderInputApi,
  CreateOAuthProviderOutput,
} from '../../contract/oauth-providers';
import { actorFromCaller } from '../_helpers';
import { toPublicProvider } from './_helpers';

export async function createOAuthProvider(
  input: CreateOAuthProviderInputApi,
  scope: CallerScope,
): Promise<CreateOAuthProviderOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespace);
  const { namespace, ...createInput } = input;

  let provider;
  try {
    provider = await scope.oauthProviders.create(namespace, createInput);
  } catch (err) {
    if (err instanceof ProviderAlreadyExistsError) {
      throw new HandlerError(
        'conflict',
        `OAuth provider "${createInput.id}" already exists in namespace "${namespace}".`,
      );
    }
    throw err;
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'oauth_provider.created',
    description: `OAuth provider '${provider.id}' created in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace,
      id: createInput.id,
      name: createInput.name,
      clientId: createInput.clientId,
      authorizeUrl: createInput.authorizeUrl,
      tokenUrl: createInput.tokenUrl,
      scopes: createInput.scopes,
    },
    outputSnapshot: { id: provider.id, createdAt: provider.createdAt },
    basis: 'OAuth provider created via API',
    entityType: 'oauthProvider',
    entityId: provider.id,
  });

  return { provider: toPublicProvider(provider) };
}

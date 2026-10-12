import type { CallerScope } from '../repositories/index';
import { HandlerError } from '../errors';

export const OPENROUTER_KEY_MISSING_MESSAGE =
  'The AI assistant needs an OpenRouter API key and this workspace has none. Add a secret named OPENROUTER_API_KEY in the workspace secrets, then try again.';

/** Every OpenRouter call is billed to the workspace's own key. */
export async function requireOpenRouterApiKey(scope: CallerScope, namespace: string): Promise<string> {
  const secrets = await scope.workspaceSecrets.getSecrets(namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new HandlerError('validation', OPENROUTER_KEY_MISSING_MESSAGE);
  }
  return apiKey;
}

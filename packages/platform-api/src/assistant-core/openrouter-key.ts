import type { CallerScope } from '../repositories/index';
import { HandlerError } from '../errors';

/** Every assistant turn is billed to the workspace's own OpenRouter key. */
export async function requireOpenRouterApiKey(scope: CallerScope, namespace: string): Promise<string> {
  const secrets = await scope.workspaceSecrets.getSecrets(namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];
  if (!apiKey) {
    throw new HandlerError('validation', 'OPENROUTER_API_KEY not configured in workspace secrets');
  }
  return apiKey;
}

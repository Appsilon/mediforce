import { describe, it, expect } from 'vitest';
import { requireOpenRouterApiKey } from '../openrouter-key';
import { createTestScope } from '../../repositories/__tests__/create-test-scope';
import { buildNamespaceSecretsRepo } from '../../handlers/secrets/__tests__/fakes';

describe('requireOpenRouterApiKey', () => {
  it("returns the workspace's own key", async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: buildNamespaceSecretsRepo({ acme: { OPENROUTER_API_KEY: 'sk-or-acme' } }),
    });
    await expect(requireOpenRouterApiKey(scope, 'acme')).resolves.toBe('sk-or-acme');
  });

  it('refuses a workspace with no OpenRouter key, naming the missing secret', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: buildNamespaceSecretsRepo({ acme: { OTHER_KEY: 'value' } }),
    });
    await expect(requireOpenRouterApiKey(scope, 'acme')).rejects.toMatchObject({
      code: 'validation',
      message: 'OPENROUTER_API_KEY not configured in workspace secrets',
    });
  });
});

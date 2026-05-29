import { describe, it, expect } from 'vitest';
import { getWorkspaceSecretPreviews } from '../get-workspace-secret-previews.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { buildNamespaceSecretsRepo } from './fakes.js';

describe('getWorkspaceSecretPreviews handler', () => {
  it('returns masked previews (4+4 for long values, bullets for short)', async () => {
    const namespaceSecretsRepo = buildNamespaceSecretsRepo({
      'team-alpha': {
        OPENROUTER_API_KEY: 'sk-or-v1-very-long-key-1234',
        SHORT: 'abc',
      },
    });
    const scope = createTestScope({
      namespaceSecretsRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { previews } = await getWorkspaceSecretPreviews({ namespace: 'team-alpha' }, scope);

    expect(previews).toContainEqual({
      key: 'OPENROUTER_API_KEY',
      preview: 'sk-o...1234',
    });
    expect(previews).toContainEqual({
      key: 'SHORT',
      preview: '••••••••',
    });
  });

  it('returns empty list for non-members (anti-enum, soft-fail)', async () => {
    const namespaceSecretsRepo = buildNamespaceSecretsRepo({
      'team-beta': { KEY: 'value-longer-than-twelve' },
    });
    const scope = createTestScope({
      namespaceSecretsRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { previews } = await getWorkspaceSecretPreviews({ namespace: 'team-beta' }, scope);

    expect(previews).toEqual([]);
  });
});

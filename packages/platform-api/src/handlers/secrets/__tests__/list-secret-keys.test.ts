import { describe, expect, it, beforeEach } from 'vitest';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { listSecretKeys } from '../list-secret-keys';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import {
  buildNamespaceSecretsRepo,
  buildWorkflowSecretsRepo,
} from './fakes';

describe('listSecretKeys handler', () => {
  let workspaceSecretsRepo: NamespaceSecretsRepository;
  let workflowSecretsRepo: WorkflowSecretsRepository;

  beforeEach(() => {
    workspaceSecretsRepo = buildNamespaceSecretsRepo({
      alpha: { OPENROUTER_API_KEY: 'sk-1', FOO: 'bar' },
      beta: { OTHER: 'x' },
    });
    workflowSecretsRepo = buildWorkflowSecretsRepo({
      alpha: { 'wf-1': { DB_URL: 'postgres://...' } },
    });
  });

  describe('workspace-level (no workflow param)', () => {
    it('returns keys for api-key callers in any workspace', async () => {
      const scope = createTestScope({
        namespaceSecretsRepo: workspaceSecretsRepo,
        secretsRepo: workflowSecretsRepo,
      });

      const result = await listSecretKeys({ namespace: 'alpha' }, scope);

      expect(result.keys.sort()).toEqual(['FOO', 'OPENROUTER_API_KEY']);
    });

    it('returns keys for user callers in the workspace', async () => {
      const scope = createTestScope({
        namespaceSecretsRepo: workspaceSecretsRepo,
        secretsRepo: workflowSecretsRepo,
        caller: userCaller('u-1', ['alpha']),
      });

      const result = await listSecretKeys({ namespace: 'alpha' }, scope);

      expect(result.keys.sort()).toEqual(['FOO', 'OPENROUTER_API_KEY']);
    });

    it('returns empty {keys: []} for user callers outside the workspace (soft-fail)', async () => {
      const scope = createTestScope({
        namespaceSecretsRepo: workspaceSecretsRepo,
        secretsRepo: workflowSecretsRepo,
        caller: userCaller('u-2', ['beta']),
      });

      const result = await listSecretKeys({ namespace: 'alpha' }, scope);

      expect(result.keys).toEqual([]);
    });
  });

  describe('workflow-level (workflow param set)', () => {
    it('returns workflow-scoped keys for api-key callers', async () => {
      const scope = createTestScope({
        namespaceSecretsRepo: workspaceSecretsRepo,
        secretsRepo: workflowSecretsRepo,
      });

      const result = await listSecretKeys(
        { namespace: 'alpha', workflow: 'wf-1' },
        scope,
      );

      expect(result.keys).toEqual(['DB_URL']);
    });

    it('returns empty {keys: []} for user callers outside the workspace', async () => {
      const scope = createTestScope({
        namespaceSecretsRepo: workspaceSecretsRepo,
        secretsRepo: workflowSecretsRepo,
        caller: userCaller('u-3', ['gamma']),
      });

      const result = await listSecretKeys(
        { namespace: 'alpha', workflow: 'wf-1' },
        scope,
      );

      expect(result.keys).toEqual([]);
    });
  });
});

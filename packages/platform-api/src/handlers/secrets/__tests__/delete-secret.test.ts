import { describe, expect, it, beforeEach } from 'vitest';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { deleteSecret } from '../delete-secret';
import { ForbiddenError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import {
  buildNamespaceSecretsRepo,
  buildWorkflowSecretsRepo,
} from './fakes';

describe('deleteSecret handler', () => {
  let workspaceSecretsRepo: NamespaceSecretsRepository;
  let workflowSecretsRepo: WorkflowSecretsRepository;

  beforeEach(() => {
    workspaceSecretsRepo = buildNamespaceSecretsRepo({
      alpha: { OPENROUTER_API_KEY: 'sk-1', KEEP_ME: 'yes' },
    });
    workflowSecretsRepo = buildWorkflowSecretsRepo({
      alpha: { 'wf-1': { DB_URL: 'postgres://...', KEEP: 'k' } },
    });
  });

  it('removes a workspace secret for an api-key caller', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
    });

    const result = await deleteSecret({ namespace: 'alpha', key: 'OPENROUTER_API_KEY' }, scope);

    expect(result).toEqual({ ok: true });
    expect(await workspaceSecretsRepo.getSecretKeys('alpha')).toEqual(['KEEP_ME']);
  });

  it('removes a workspace secret for a user caller in the namespace', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      caller: userCaller('u-1', ['alpha']),
    });

    await deleteSecret({ namespace: 'alpha', key: 'KEEP_ME' }, scope);

    expect(await workspaceSecretsRepo.getSecretKeys('alpha')).toEqual(['OPENROUTER_API_KEY']);
  });

  it('removes a workflow-scoped secret when workflow param is set', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
    });

    await deleteSecret({ namespace: 'alpha', workflow: 'wf-1', key: 'DB_URL' }, scope);

    expect(await workflowSecretsRepo.getSecretKeys('alpha', 'wf-1')).toEqual(['KEEP']);
  });

  it('throws ForbiddenError when a user caller deletes outside their namespaces', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(
      deleteSecret({ namespace: 'alpha', key: 'KEEP_ME' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      deleteSecret({ namespace: 'alpha', workflow: 'wf-1', key: 'DB_URL' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

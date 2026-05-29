import { describe, expect, it, beforeEach } from 'vitest';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { setSecret } from '../set-secret';
import { ForbiddenError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import {
  buildNamespaceSecretsRepo,
  buildWorkflowSecretsRepo,
} from './fakes';

describe('setSecret handler', () => {
  let workspaceSecretsRepo: NamespaceSecretsRepository;
  let workflowSecretsRepo: WorkflowSecretsRepository;

  beforeEach(() => {
    workspaceSecretsRepo = buildNamespaceSecretsRepo({ alpha: {} });
    workflowSecretsRepo = buildWorkflowSecretsRepo({ alpha: { 'wf-1': {} } });
  });

  it('writes a workspace secret for an api-key caller', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
    });

    const result = await setSecret(
      { namespace: 'alpha', key: 'OPENROUTER_API_KEY', value: 'sk-1' },
      scope,
    );

    expect(result).toEqual({ ok: true });
    expect(await workspaceSecretsRepo.getSecrets('alpha')).toEqual({ OPENROUTER_API_KEY: 'sk-1' });
  });

  it('writes a workspace secret for a user caller in the namespace', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      caller: userCaller('u-1', ['alpha']),
    });

    await setSecret({ namespace: 'alpha', key: 'X', value: 'y' }, scope);

    expect(await workspaceSecretsRepo.getSecrets('alpha')).toEqual({ X: 'y' });
  });

  it('writes a workflow-scoped secret when workflow param is set', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
    });

    await setSecret(
      { namespace: 'alpha', workflow: 'wf-1', key: 'DB_URL', value: 'postgres://...' },
      scope,
    );

    expect(await workflowSecretsRepo.getSecrets('alpha', 'wf-1')).toEqual({ DB_URL: 'postgres://...' });
    expect(await workspaceSecretsRepo.getSecrets('alpha')).toEqual({});
  });

  it('throws ForbiddenError when a user caller writes outside their namespaces', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(
      setSecret({ namespace: 'alpha', key: 'X', value: 'y' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      setSecret({ namespace: 'alpha', workflow: 'wf-1', key: 'X', value: 'y' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

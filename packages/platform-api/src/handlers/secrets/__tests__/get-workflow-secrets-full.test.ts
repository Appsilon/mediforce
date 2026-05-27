import { describe, expect, it, beforeEach } from 'vitest';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { getWorkflowSecretsFull } from '../get-workflow-secrets-full.js';
import { ForbiddenError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';
import {
  buildNamespaceSecretsRepo,
  buildWorkflowSecretsRepo,
} from './fakes.js';

describe('getWorkflowSecretsFull handler', () => {
  let workspaceSecretsRepo: NamespaceSecretsRepository;
  let workflowSecretsRepo: WorkflowSecretsRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    workspaceSecretsRepo = buildNamespaceSecretsRepo({ alpha: {} });
    workflowSecretsRepo = buildWorkflowSecretsRepo({
      alpha: { 'wf-1': { OPENROUTER_API_KEY: 'sk-1', VIKING_PASSWORD: 's3cret' } },
    });
    auditRepo = new InMemoryAuditRepository();
  });

  it('returns full secrets for a user caller in the namespace and emits audit', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
      caller: userCaller('u-1', ['alpha']),
    });

    const result = await getWorkflowSecretsFull(
      { namespace: 'alpha', workflow: 'wf-1' },
      scope,
    );

    expect(result.secrets).toEqual({ OPENROUTER_API_KEY: 'sk-1', VIKING_PASSWORD: 's3cret' });

    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'workflow_secret.values_revealed',
      actorId: 'u-1',
      actorType: 'user',
      entityType: 'workflowSecret',
      entityId: 'alpha/wf-1',
    });
    expect(events[0].outputSnapshot).toEqual({
      revealedKeys: ['OPENROUTER_API_KEY', 'VIKING_PASSWORD'],
    });
  });

  it('returns full secrets for an api-key (system) caller and emits audit', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
    });

    const result = await getWorkflowSecretsFull(
      { namespace: 'alpha', workflow: 'wf-1' },
      scope,
    );

    expect(result.secrets).toEqual({ OPENROUTER_API_KEY: 'sk-1', VIKING_PASSWORD: 's3cret' });
    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'workflow_secret.values_revealed',
      actorId: 'api',
      actorType: 'system',
    });
  });

  it('throws ForbiddenError without reading or auditing when caller is outside the namespace', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(
      getWorkflowSecretsFull({ namespace: 'alpha', workflow: 'wf-1' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const events = auditRepo.getAll();
    expect(events).toEqual([]);
  });
});

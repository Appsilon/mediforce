import { describe, expect, it, beforeEach } from 'vitest';
import type {
  NamespaceSecretsRepository,
  WorkflowSecretsRepository,
} from '@mediforce/platform-core';
import { InMemoryAuditRepository } from '@mediforce/platform-core/testing';
import { saveWorkflowSecrets } from '../save-workflow-secrets';
import { ForbiddenError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import {
  buildNamespaceSecretsRepo,
  buildWorkflowSecretsRepo,
} from './fakes';

describe('saveWorkflowSecrets handler', () => {
  let workspaceSecretsRepo: NamespaceSecretsRepository;
  let workflowSecretsRepo: WorkflowSecretsRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    workspaceSecretsRepo = buildNamespaceSecretsRepo({ alpha: {} });
    workflowSecretsRepo = buildWorkflowSecretsRepo({
      alpha: { 'wf-1': { LEGACY_KEY: 'old-value' } },
    });
    auditRepo = new InMemoryAuditRepository();
  });

  it('atomically replaces all secrets for a user caller in the namespace and emits audit', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
      caller: userCaller('u-1', ['alpha']),
    });

    const result = await saveWorkflowSecrets(
      {
        namespace: 'alpha',
        workflow: 'wf-1',
        secrets: { OPENROUTER_API_KEY: 'sk-1', NEW_KEY: 'new-value' },
      },
      scope,
    );

    expect(result).toEqual({ ok: true, savedKeyCount: 2 });
    // LEGACY_KEY removed (atomic replace, not merge)
    expect(await workflowSecretsRepo.getSecrets('alpha', 'wf-1')).toEqual({
      OPENROUTER_API_KEY: 'sk-1',
      NEW_KEY: 'new-value',
    });

    const events = auditRepo.getAll();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'workflow_secret.bulk_saved',
      actorId: 'u-1',
      actorType: 'user',
      entityType: 'workflowSecret',
      entityId: 'alpha/wf-1',
    });
    expect(events[0].inputSnapshot).toEqual({
      namespace: 'alpha',
      workflow: 'wf-1',
      savedKeys: ['OPENROUTER_API_KEY', 'NEW_KEY'],
    });
    // Audit must not leak values
    expect(JSON.stringify(events[0])).not.toContain('sk-1');
    expect(JSON.stringify(events[0])).not.toContain('new-value');
  });

  it('supports an empty secret map (clears the workflow)', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
    });

    const result = await saveWorkflowSecrets(
      { namespace: 'alpha', workflow: 'wf-1', secrets: {} },
      scope,
    );

    expect(result).toEqual({ ok: true, savedKeyCount: 0 });
    expect(await workflowSecretsRepo.getSecrets('alpha', 'wf-1')).toEqual({});
  });

  it('throws ForbiddenError without writing or auditing when caller is outside the namespace', async () => {
    const scope = createTestScope({
      namespaceSecretsRepo: workspaceSecretsRepo,
      secretsRepo: workflowSecretsRepo,
      auditRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(
      saveWorkflowSecrets(
        { namespace: 'alpha', workflow: 'wf-1', secrets: { X: 'y' } },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    // No write happened
    expect(await workflowSecretsRepo.getSecrets('alpha', 'wf-1')).toEqual({
      LEGACY_KEY: 'old-value',
    });
    // No audit emitted
    expect(auditRepo.getAll()).toEqual([]);
  });
});

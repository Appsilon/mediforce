import { describe, it, expect } from 'vitest';
import { listWorkflowSecretKeysBatch } from '../list-workflow-secret-keys-batch.js';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope.js';
import { buildWorkflowSecretsRepo } from './fakes.js';

describe('listWorkflowSecretKeysBatch handler', () => {
  it('returns per-workflow key arrays in one call', async () => {
    const secretsRepo = buildWorkflowSecretsRepo({
      'team-alpha': {
        wf1: { A: '1', B: '2' },
        wf2: { C: '3' },
      },
    });
    const scope = createTestScope({
      secretsRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { keysByWorkflow } = await listWorkflowSecretKeysBatch(
      { namespace: 'team-alpha', workflows: ['wf1', 'wf2', 'missing'] },
      scope,
    );

    expect(keysByWorkflow.wf1?.sort()).toEqual(['A', 'B']);
    expect(keysByWorkflow.wf2).toEqual(['C']);
    expect(keysByWorkflow.missing).toEqual([]);
  });

  it('soft-fails to empty arrays for non-members', async () => {
    const secretsRepo = buildWorkflowSecretsRepo({
      'team-beta': { wf1: { K: 'v' } },
    });
    const scope = createTestScope({
      secretsRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const { keysByWorkflow } = await listWorkflowSecretKeysBatch(
      { namespace: 'team-beta', workflows: ['wf1'] },
      scope,
    );

    expect(keysByWorkflow.wf1).toEqual([]);
  });
});

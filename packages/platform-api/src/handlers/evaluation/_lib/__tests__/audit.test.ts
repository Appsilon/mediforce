import { describe, it, expect } from 'vitest';
import { InMemoryAuditRepository, InMemoryProcessInstanceRepository } from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../../repositories/__tests__/create-test-scope';
import { appendEvaluationAudit, authorId } from '../audit';

describe('Evaluation audit', () => {
  it('records the write as the caller', async () => {
    const auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    const scope = createTestScope({ auditRepo, caller: userCaller('author-1', ['pharma-a']) });

    await appendEvaluationAudit(scope, {
      action: 'evaluator.created',
      description: 'Evaluator created',
      namespace: 'pharma-a',
      entityType: 'evaluator',
      entityId: 'evaluator-1',
      inputSnapshot: { name: 'findings-present' },
      basis: 'test',
    });

    const [event] = await auditRepo.getByEntity('evaluator', 'evaluator-1');
    expect(event).toMatchObject({ actorId: 'author-1', actorType: 'user', action: 'evaluator.created', outputSnapshot: {} });
  });

  it('names an API key caller as the author', () => {
    expect(authorId(createTestScope())).toBe('api-user');
    expect(authorId(createTestScope({ caller: userCaller('author-1', ['pharma-a']) }))).toBe('author-1');
  });
});

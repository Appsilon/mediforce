import { describe, it, expect, vi } from 'vitest';
import { InMemoryAuditRepository, InMemoryProcessInstanceRepository } from '@mediforce/platform-core/testing';
import { recordAssistantPrompt } from '../prompt-audit';
import { createTestScope, userCaller } from '../../repositories/__tests__/create-test-scope';

const entry = {
  namespace: 'acme',
  model: 'anthropic/claude-sonnet-4',
  messages: [
    { role: 'user', content: 'What should I check on the grading step?' },
    { role: 'assistant', content: 'Start with the output schema.' },
    { role: 'user', content: 'Draft a check that every AE has a CTCAE grade.' },
  ],
  action: 'evaluation_assistant.prompt',
  description: 'Evaluation Assistant prompt',
  basis: 'Evaluation Assistant request',
  entityType: 'evaluation_assistant',
  entityId: 'acme/ae-grading/grade-aes',
  logTag: 'evaluation-assistant',
};

describe('recordAssistantPrompt', () => {
  it('records the latest user message as the caller', async () => {
    const auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    const scope = createTestScope({ auditRepo, caller: userCaller('reviewer-1', ['acme']) });

    await recordAssistantPrompt(scope, entry);

    const [event] = await auditRepo.getByEntity('evaluation_assistant', 'acme/ae-grading/grade-aes');
    expect(event).toMatchObject({
      action: 'evaluation_assistant.prompt',
      actorType: 'user',
      inputSnapshot: {
        prompt: 'Draft a check that every AE has a CTCAE grade.',
        model: 'anthropic/claude-sonnet-4',
        messageCount: 3,
      },
    });
  });

  it('never fails the turn when the audit append fails', async () => {
    const scope = createTestScope();
    vi.spyOn(scope.system.audit, 'append').mockRejectedValue(new Error('audit down'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(recordAssistantPrompt(scope, entry)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(
      '[evaluation-assistant] failed to write prompt audit entry (non-fatal):',
      expect.any(Error),
    );
    log.mockRestore();
  });
});

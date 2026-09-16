import { describe, it, expect } from 'vitest';
import { InMemoryWorkflowAssistantInstructionsRepository } from '@mediforce/platform-core/testing';
import { getAssistantInstructions } from '../get-instructions';
import { ForbiddenError, ValidationError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('getAssistantInstructions', () => {
  it('returns what this user saved in this workspace', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', 'Name every step in Polish.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    expect(await getAssistantInstructions({ namespace: 'team-alpha' }, scope))
      .toEqual({ instructions: 'Name every step in Polish.' });
  });

  it('keeps the same person’s workspaces apart', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', 'Alpha style.');
    await assistantInstructionsRepo.set('team-beta', 'u-1', 'Beta style.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha', 'team-beta']),
      assistantInstructionsRepo,
    });

    expect(await getAssistantInstructions({ namespace: 'team-beta' }, scope))
      .toEqual({ instructions: 'Beta style.' });
  });

  it('answers empty when this person has written nothing here', async () => {
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo: new InMemoryWorkflowAssistantInstructionsRepository(),
    });

    expect(await getAssistantInstructions({ namespace: 'team-alpha' }, scope))
      .toEqual({ instructions: '' });
  });

  it('never returns another member’s text from a shared workspace', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-2', 'Someone else’s conventions.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    expect(await getAssistantInstructions({ namespace: 'team-alpha' }, scope))
      .toEqual({ instructions: '' });
  });

  it('refuses a user caller naming another uid', async () => {
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo: new InMemoryWorkflowAssistantInstructionsRepository(),
    });

    await expect(getAssistantInstructions({ namespace: 'team-alpha', uid: 'u-2' }, scope))
      .rejects.toThrow(ForbiddenError);
  });

  it('answers empty for a workspace the caller cannot see, rather than confirming it exists', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-secret', 'u-1', 'Private.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    expect(await getAssistantInstructions({ namespace: 'team-secret' }, scope))
      .toEqual({ instructions: '' });
  });

  it('makes an apiKey caller name the uid it is reading for', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-7', 'Pushed from a file.');
    const scope = createTestScope({ assistantInstructionsRepo });

    await expect(getAssistantInstructions({ namespace: 'team-alpha' }, scope))
      .rejects.toThrow(ValidationError);
    expect(await getAssistantInstructions({ namespace: 'team-alpha', uid: 'u-7' }, scope))
      .toEqual({ instructions: 'Pushed from a file.' });
  });
});

import { describe, it, expect } from 'vitest';
import { InMemoryWorkflowAssistantInstructionsRepository } from '@mediforce/platform-core/testing';
import { setAssistantInstructions } from '../set-instructions';
import { ForbiddenError, ValidationError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('setAssistantInstructions', () => {
  it('stores the text against the caller and the workspace', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    expect(await setAssistantInstructions(
      { namespace: 'team-alpha', instructions: 'Name every step in Polish.' },
      scope,
    )).toEqual({ ok: true });

    const stored = await assistantInstructionsRepo.get('team-alpha', 'u-1');
    expect(stored?.instructions).toBe('Name every step in Polish.');
  });

  it('clears the row on an empty string, so "saved nothing" has one meaning', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    await setAssistantInstructions({ namespace: 'team-alpha', instructions: 'Temporary.' }, scope);
    await setAssistantInstructions({ namespace: 'team-alpha', instructions: '' }, scope);

    expect(await assistantInstructionsRepo.get('team-alpha', 'u-1')).toBeNull();
  });

  it('refuses a write to a workspace the caller is not a member of', async () => {
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo: new InMemoryWorkflowAssistantInstructionsRepository(),
    });

    await expect(setAssistantInstructions({ namespace: 'team-beta', instructions: 'x' }, scope))
      .rejects.toThrow(ForbiddenError);
  });

  it('refuses a user caller writing another uid’s row', async () => {
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo: new InMemoryWorkflowAssistantInstructionsRepository(),
    });

    await expect(setAssistantInstructions(
      { namespace: 'team-alpha', uid: 'u-2', instructions: 'x' },
      scope,
    )).rejects.toThrow(ForbiddenError);
  });

  it('lets an apiKey caller write for a named user — the CLI pushing a file', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    const scope = createTestScope({ assistantInstructionsRepo });

    await expect(setAssistantInstructions({ namespace: 'team-alpha', instructions: 'x' }, scope))
      .rejects.toThrow(ValidationError);

    await setAssistantInstructions(
      { namespace: 'team-alpha', uid: 'u-7', instructions: 'Pushed from a file.' },
      scope,
    );
    expect((await assistantInstructionsRepo.get('team-alpha', 'u-7'))?.instructions)
      .toBe('Pushed from a file.');
  });
});

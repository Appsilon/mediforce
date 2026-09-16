import { describe, it, expect } from 'vitest';
import { InMemoryWorkflowAssistantInstructionsRepository } from '@mediforce/platform-core/testing';
import { callerInstructionMessages } from '../caller-instructions';
import { createTestScope, userCaller } from '../../../../repositories/__tests__/create-test-scope';

describe('callerInstructionMessages', () => {
  it('carries the saved text in a single system message', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', 'Name every step in Polish.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    const messages = await callerInstructionMessages(scope, 'team-alpha');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('Name every step in Polish.');
  });

  it('says the instructions cannot buy their way past validation', async () => {
    // Without this the conventions read as absolute, and the first one that
    // collides with the schema produces a canvas that fails on Save.
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', 'Skip the terminal step.');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    const [message] = await callerInstructionMessages(scope, 'team-alpha');

    expect(message?.content).toMatch(/do not relax rules/i);
    expect(message?.content).toMatch(/say plainly in your reply/i);
  });

  it('returns nothing when this person has saved nothing', async () => {
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo: new InMemoryWorkflowAssistantInstructionsRepository(),
    });

    expect(await callerInstructionMessages(scope, 'team-alpha')).toEqual([]);
  });

  it('returns nothing for whitespace, so a cleared textarea costs no tokens', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', '   \n\n  ');
    const scope = createTestScope({
      caller: userCaller('u-1', ['team-alpha']),
      assistantInstructionsRepo,
    });

    expect(await callerInstructionMessages(scope, 'team-alpha')).toEqual([]);
  });

  it('returns nothing for an apiKey caller, which has no user to read them for', async () => {
    const assistantInstructionsRepo = new InMemoryWorkflowAssistantInstructionsRepository();
    await assistantInstructionsRepo.set('team-alpha', 'u-1', 'Name every step in Polish.');
    const scope = createTestScope({ assistantInstructionsRepo });

    expect(await callerInstructionMessages(scope, 'team-alpha')).toEqual([]);
  });
});

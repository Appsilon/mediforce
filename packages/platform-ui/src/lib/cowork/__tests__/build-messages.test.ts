import { describe, it, expect } from 'vitest';
import { buildMessages, ARTIFACT_TOOL } from '../build-messages.js';
import type { CoworkSession } from '@mediforce/platform-core';

function makeSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: 'session-001',
    processInstanceId: 'inst-001',
    stepId: 'design',
    assignedRole: 'analyst',
    assignedUserId: null,
    status: 'active',
    model: null,
    systemPrompt: null,
    outputSchema: null,
    artifact: null,
    turns: [],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    finalizedAt: null,
    ...overrides,
  };
}

describe('buildMessages', () => {
  it('builds minimal messages with just a new human message', () => {
    const session = makeSession();
    const messages = buildMessages(session, 'Hello agent');

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello agent' });
  });

  it('includes system prompt from session config', () => {
    const session = makeSession({ systemPrompt: 'Help design a workflow.' });
    const messages = buildMessages(session, 'Start');

    expect(messages[0].content).toContain('Help design a workflow.');
  });

  it('includes output schema in system prompt', () => {
    const session = makeSession({
      outputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    });
    const messages = buildMessages(session, 'Start');

    expect(messages[0].content).toContain('"type": "object"');
    expect(messages[0].content).toContain('Output Schema');
  });

  it('includes step context from previous step', () => {
    const session = makeSession();
    const stepContext = { idea: 'safety review process', priority: 'high' };
    const messages = buildMessages(session, 'Start', stepContext);

    expect(messages[0].content).toContain('Context from previous step');
    expect(messages[0].content).toContain('"idea": "safety review process"');
  });

  it('includes current artifact state when present', () => {
    const session = makeSession({
      artifact: { name: 'my-workflow', steps: ['intake', 'review'] },
    });
    const messages = buildMessages(session, 'Add a terminal step');

    // System prompt + artifact context + new message = 3
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('Current artifact state');
    expect(messages[1].content).toContain('my-workflow');
  });

  it('includes conversation history as user/assistant messages', () => {
    const session = makeSession({
      turns: [
        {
          id: 't1',
          role: 'human',
          content: 'I want a safety review',
          timestamp: '2026-01-15T10:01:00Z',
          artifactDelta: null,
        },
        {
          id: 't2',
          role: 'agent',
          content: 'Here is a draft.',
          timestamp: '2026-01-15T10:01:05Z',
          artifactDelta: { name: 'safety-review' },
        },
      ],
    });

    const messages = buildMessages(session, 'Change the name');

    // system + turn1(user) + turn2(assistant) + new message = 4
    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual({ role: 'user', content: 'I want a safety review' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Here is a draft.' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Change the name' });
  });

  it('maps turn roles correctly: human → user, agent → assistant', () => {
    const session = makeSession({
      turns: [
        { id: 't1', role: 'human', content: 'q', timestamp: '2026-01-15T10:00:00Z', artifactDelta: null },
        { id: 't2', role: 'agent', content: 'a', timestamp: '2026-01-15T10:00:01Z', artifactDelta: null },
      ],
    });

    const messages = buildMessages(session, 'follow up');

    const turnMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(turnMessages[0].role).toBe('user');
    expect(turnMessages[1].role).toBe('assistant');
    expect(turnMessages[2].role).toBe('user'); // new message
  });

  it('handles full scenario: system prompt + schema + artifact + history + new message', () => {
    const session = makeSession({
      systemPrompt: 'Design a clinical trial workflow.',
      outputSchema: { type: 'object' },
      artifact: { name: 'trial-workflow' },
      turns: [
        { id: 't1', role: 'human', content: 'Start with intake', timestamp: '2026-01-15T10:00:00Z', artifactDelta: null },
        { id: 't2', role: 'agent', content: 'Added intake step.', timestamp: '2026-01-15T10:00:01Z', artifactDelta: null },
      ],
    });

    const messages = buildMessages(session, 'Now add review', { protocolId: 'P-001' });

    // system + artifact_context + t1 + t2 + new = 5
    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Design a clinical trial workflow');
    expect(messages[0].content).toContain('protocolId');
    expect(messages[1].content).toContain('trial-workflow');
    expect(messages[4]).toEqual({ role: 'user', content: 'Now add review' });
  });

  it('skips step context when empty', () => {
    const session = makeSession();
    const messages = buildMessages(session, 'Hello', {});

    expect(messages[0].content).not.toContain('Context from previous step');
  });
});

describe('ARTIFACT_TOOL', () => {
  it('has the correct structure for OpenRouter/OpenAI function calling', () => {
    expect(ARTIFACT_TOOL.type).toBe('function');
    expect(ARTIFACT_TOOL.function.name).toBe('update_artifact');
    expect(ARTIFACT_TOOL.function.parameters.required).toContain('artifact');
  });
});

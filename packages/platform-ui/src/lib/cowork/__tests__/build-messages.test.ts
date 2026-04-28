import { describe, it, expect } from 'vitest';
import { buildMessages, ARTIFACT_TOOL } from '../build-messages.js';
import type { CoworkSession, ConversationTurn } from '@mediforce/platform-core';

function makeSession(overrides?: Partial<CoworkSession>): CoworkSession {
  return {
    id: 'session-001',
    processInstanceId: 'inst-001',
    stepId: 'design',
    assignedRole: 'analyst',
    assignedUserId: null,
    status: 'active',
    agent: 'chat',
    model: null,
    systemPrompt: null,
    outputSchema: null,
    voiceConfig: null,
    artifact: null,
    mcpServers: null,
    turns: [],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    finalizedAt: null,
    ...overrides,
  };
}

function humanTurn(content: string, id = 'h1', ts = '2026-01-15T10:01:00Z'): ConversationTurn {
  return { id, role: 'human', content, timestamp: ts, artifactDelta: null };
}

function agentTurn(content: string, id = 'a1', ts = '2026-01-15T10:01:05Z'): ConversationTurn {
  return { id, role: 'agent', content, timestamp: ts, artifactDelta: null };
}

describe('buildMessages', () => {
  it('builds minimal messages with just a new human turn', () => {
    const session = makeSession({ turns: [humanTurn('Hello agent')] });
    const messages = buildMessages(session);

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Hello agent' });
  });

  it('does not duplicate the latest human turn', () => {
    const session = makeSession({ turns: [humanTurn('Only once, please')] });
    const messages = buildMessages(session);

    const userMessages = messages.filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0].content).toBe('Only once, please');
  });

  it('includes system prompt from session config', () => {
    const session = makeSession({
      systemPrompt: 'Help design a workflow.',
      turns: [humanTurn('Start')],
    });
    const messages = buildMessages(session);

    expect(messages[0].content).toContain('Help design a workflow.');
  });

  it('includes output schema in system prompt', () => {
    const session = makeSession({
      outputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      turns: [humanTurn('Start')],
    });
    const messages = buildMessages(session);

    expect(messages[0].content).toContain('"type": "object"');
    expect(messages[0].content).toContain('Output Schema');
  });

  it('includes step context from previous step', () => {
    const session = makeSession({ turns: [humanTurn('Start')] });
    const stepContext = { idea: 'safety review process', priority: 'high' };
    const messages = buildMessages(session, stepContext);

    expect(messages[0].content).toContain('Context from previous step');
    expect(messages[0].content).toContain('"idea": "safety review process"');
  });

  it('includes current artifact state when present', () => {
    const session = makeSession({
      artifact: { name: 'my-workflow', steps: ['intake', 'review'] },
      turns: [humanTurn('Add a terminal step')],
    });
    const messages = buildMessages(session);

    // system + artifact context + human turn = 3
    expect(messages).toHaveLength(3);
    expect(messages[1].role).toBe('system');
    expect(messages[1].content).toContain('Current artifact state');
    expect(messages[1].content).toContain('my-workflow');
  });

  it('includes full conversation history as user/assistant messages', () => {
    const session = makeSession({
      turns: [
        humanTurn('I want a safety review', 't1'),
        {
          id: 't2',
          role: 'agent',
          content: 'Here is a draft.',
          timestamp: '2026-01-15T10:01:05Z',
          artifactDelta: { name: 'safety-review' },
        },
        humanTurn('Change the name', 't3', '2026-01-15T10:01:10Z'),
      ],
    });

    const messages = buildMessages(session);

    // system + t1(user) + t2(assistant) + t3(user) = 4
    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual({ role: 'user', content: 'I want a safety review' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Here is a draft.' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Change the name' });
  });

  it('maps turn roles correctly: human → user, agent → assistant', () => {
    const session = makeSession({
      turns: [
        humanTurn('q', 't1', '2026-01-15T10:00:00Z'),
        agentTurn('a', 't2', '2026-01-15T10:00:01Z'),
        humanTurn('follow up', 't3', '2026-01-15T10:00:02Z'),
      ],
    });

    const messages = buildMessages(session);

    const turnMessages = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    expect(turnMessages[0].role).toBe('user');
    expect(turnMessages[1].role).toBe('assistant');
    expect(turnMessages[2].role).toBe('user');
  });

  it('skips tool turns — they are intermediate Firestore state', () => {
    const session = makeSession({
      turns: [
        humanTurn('Run the tool', 't1'),
        {
          id: 't2',
          role: 'tool',
          content: '',
          timestamp: '2026-01-15T10:01:05Z',
          artifactDelta: null,
          toolName: 'svr__do_it',
          toolArgs: {},
          toolStatus: 'success',
          toolResult: 'ok',
          serverName: 'svr',
        },
      ],
    });

    const messages = buildMessages(session);

    // system + human turn only (tool turn filtered)
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('handles full scenario: system prompt + schema + artifact + history', () => {
    const session = makeSession({
      systemPrompt: 'Design a clinical trial workflow.',
      outputSchema: { type: 'object' },
      artifact: { name: 'trial-workflow' },
      turns: [
        humanTurn('Start with intake', 't1', '2026-01-15T10:00:00Z'),
        agentTurn('Added intake step.', 't2', '2026-01-15T10:00:01Z'),
        humanTurn('Now add review', 't3', '2026-01-15T10:00:02Z'),
      ],
    });

    const messages = buildMessages(session, { protocolId: 'P-001' });

    // system + artifact_context + t1 + t2 + t3 = 5
    expect(messages).toHaveLength(5);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Design a clinical trial workflow');
    expect(messages[0].content).toContain('protocolId');
    expect(messages[1].content).toContain('trial-workflow');
    expect(messages[4]).toEqual({ role: 'user', content: 'Now add review' });
  });

  it('skips step context when empty', () => {
    const session = makeSession({ turns: [humanTurn('Hello')] });
    const messages = buildMessages(session, {});

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

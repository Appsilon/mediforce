import { describe, it, expect } from 'vitest';
import { buildMessages, ARTIFACT_TOOL } from '../build-messages';
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
    validationResult: null,
    presentation: null,
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

function toolTurn(
  toolName: string,
  toolResult: string,
  opts?: { id?: string; toolCallId?: string; toolArgs?: Record<string, unknown> },
): ConversationTurn {
  return {
    id: opts?.id ?? `tool-${toolName}`,
    role: 'tool',
    content: '',
    timestamp: '2026-01-15T10:01:03Z',
    artifactDelta: null,
    toolName,
    toolArgs: opts?.toolArgs ?? {},
    toolStatus: 'success',
    toolResult,
    serverName: toolName.split('__')[0] ?? 'unknown',
    ...(opts?.toolCallId !== undefined ? { toolCallId: opts.toolCallId } : {}),
  };
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

  it('skips orphan tool turns at the end (in-progress current request)', () => {
    const session = makeSession({
      turns: [
        humanTurn('Run the tool', 't1'),
        toolTurn('svr__do_it', 'ok', { id: 't2' }),
      ],
    });

    const messages = buildMessages(session);

    // system + human turn only (orphan tool turns at end are skipped)
    expect(messages).toHaveLength(2);
    expect(messages.some((m) => m.role === 'tool')).toBe(false);
  });

  it('reconstructs tool-use history: tool turns before agent become assistant+tool_calls then tool results', () => {
    const session = makeSession({
      turns: [
        humanTurn('Check the data', 't1'),
        toolTurn('svr__query', '{"rows": 42}', { id: 't2', toolCallId: 'tc-abc' }),
        agentTurn('Found 42 rows.', 't3'),
      ],
    });

    const messages = buildMessages(session);

    // system + user + assistant(with tool_calls) + tool_result = 4
    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual({ role: 'user', content: 'Check the data' });

    // Assistant message carries tool_calls
    const assistantMsg = messages[2];
    expect(assistantMsg.role).toBe('assistant');
    expect(assistantMsg.content).toBe('Found 42 rows.');
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls![0].id).toBe('tc-abc');
    expect(assistantMsg.tool_calls![0].function.name).toBe('svr__query');

    // Tool result message
    const toolMsg = messages[3];
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toBe('{"rows": 42}');
    expect(toolMsg.tool_call_id).toBe('tc-abc');
  });

  it('generates synthetic tool_call_id for old sessions without toolCallId', () => {
    const session = makeSession({
      turns: [
        humanTurn('Do something', 't1'),
        toolTurn('svr__action', 'done', { id: 't2' }), // no toolCallId
        agentTurn('Action complete.', 'agent-123'),
      ],
    });

    const messages = buildMessages(session);

    // Synthetic ID is agentTurnId-tc{index}
    const assistantMsg = messages[2];
    expect(assistantMsg.tool_calls![0].id).toBe('agent-123-tc0');
    expect(messages[3].tool_call_id).toBe('agent-123-tc0');
  });

  it('handles multiple tool calls before a single agent turn', () => {
    const session = makeSession({
      turns: [
        humanTurn('Run two tools', 't1'),
        toolTurn('svr__tool_a', 'result-a', { id: 't2', toolCallId: 'tc-1' }),
        toolTurn('svr__tool_b', 'result-b', { id: 't3', toolCallId: 'tc-2' }),
        agentTurn('Both done.', 't4'),
      ],
    });

    const messages = buildMessages(session);

    // system + user + assistant(2 tool_calls) + tool_result_a + tool_result_b = 5
    expect(messages).toHaveLength(5);
    expect(messages[2].tool_calls).toHaveLength(2);
    expect(messages[2].tool_calls![0].id).toBe('tc-1');
    expect(messages[2].tool_calls![1].id).toBe('tc-2');
    expect(messages[3]).toEqual({ role: 'tool', content: 'result-a', tool_call_id: 'tc-1' });
    expect(messages[4]).toEqual({ role: 'tool', content: 'result-b', tool_call_id: 'tc-2' });
  });

  it('handles multi-turn conversation with tools across rounds', () => {
    const session = makeSession({
      turns: [
        humanTurn('First question', 't1'),
        toolTurn('svr__query', 'data-1', { id: 't2', toolCallId: 'tc-r1' }),
        agentTurn('Here is round 1.', 't3'),
        humanTurn('Second question', 't4'),
        toolTurn('svr__query', 'data-2', { id: 't5', toolCallId: 'tc-r2' }),
        agentTurn('Here is round 2.', 't6'),
        humanTurn('Follow up', 't7'),
      ],
    });

    const messages = buildMessages(session);

    // system + user + assistant+tool_calls + tool + user + assistant+tool_calls + tool + user = 8
    expect(messages).toHaveLength(8);

    // Round 1
    expect(messages[1]).toEqual({ role: 'user', content: 'First question' });
    expect(messages[2].role).toBe('assistant');
    expect(messages[2].tool_calls![0].id).toBe('tc-r1');
    expect(messages[3]).toEqual({ role: 'tool', content: 'data-1', tool_call_id: 'tc-r1' });

    // Round 2
    expect(messages[4]).toEqual({ role: 'user', content: 'Second question' });
    expect(messages[5].role).toBe('assistant');
    expect(messages[5].tool_calls![0].id).toBe('tc-r2');
    expect(messages[6]).toEqual({ role: 'tool', content: 'data-2', tool_call_id: 'tc-r2' });

    // Follow up
    expect(messages[7]).toEqual({ role: 'user', content: 'Follow up' });
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

  it('serializes toolArgs as JSON in the tool_calls function arguments', () => {
    const session = makeSession({
      turns: [
        humanTurn('Query drugs', 't1'),
        toolTurn('svr__search', 'found 5', {
          id: 't2',
          toolCallId: 'tc-x',
          toolArgs: { query: 'aspirin', limit: 10 },
        }),
        agentTurn('Found 5 results.', 't3'),
      ],
    });

    const messages = buildMessages(session);
    const args = messages[2].tool_calls![0].function.arguments;
    expect(JSON.parse(args)).toEqual({ query: 'aspirin', limit: 10 });
  });
});

describe('ARTIFACT_TOOL', () => {
  it('has the correct structure for OpenRouter/OpenAI function calling', () => {
    expect(ARTIFACT_TOOL.type).toBe('function');
    expect(ARTIFACT_TOOL.function.name).toBe('update_artifact');
    expect(ARTIFACT_TOOL.function.parameters.required).toContain('artifact');
  });
});

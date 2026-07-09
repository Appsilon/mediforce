import { describe, it, expect } from 'vitest';
import {
  ChatCoworkSessionInputSchema,
  ChatCoworkSessionOutputSchema,
} from '../cowork';

const validSession = {
  id: 'sess-1',
  processInstanceId: 'inst-1',
  stepId: 'step-1',
  assignedRole: 'analyst',
  assignedUserId: null,
  status: 'active' as const,
  agent: 'chat' as const,
  model: null,
  systemPrompt: null,
  outputSchema: null,
  voiceConfig: null,
  artifact: null,
  mcpServers: null,
  turns: [],
  createdAt: '2026-05-28T00:00:00.000Z',
  updatedAt: '2026-05-28T00:00:01.000Z',
  finalizedAt: null,
};

describe('ChatCoworkSessionInputSchema', () => {
  it('accepts a non-empty sessionId + message', () => {
    const result = ChatCoworkSessionInputSchema.safeParse({
      sessionId: 'sess-1',
      message: 'hi',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty message', () => {
    const result = ChatCoworkSessionInputSchema.safeParse({
      sessionId: 'sess-1',
      message: '   ',
    });
    expect(result.success).toBe(false);
  });
});

describe('ChatCoworkSessionOutputSchema — additive session + turns extension', () => {
  it('accepts the post-Phase-4 shape with session + turns', () => {
    const result = ChatCoworkSessionOutputSchema.safeParse({
      turnId: 'turn-1',
      agentText: 'hello back',
      toolCalls: [],
      session: validSession,
      turns: [
        {
          id: 't-1',
          role: 'human',
          content: 'hi',
          timestamp: '2026-05-28T00:00:00.000Z',
          artifactDelta: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the legacy shape that omits the new required fields (no silent fallback)', () => {
    const result = ChatCoworkSessionOutputSchema.safeParse({
      turnId: 'turn-1',
      agentText: 'hello back',
      toolCalls: [],
    });
    expect(result.success).toBe(false);
  });

  it('preserves the artifact field as optional (backwards-compatible)', () => {
    const result = ChatCoworkSessionOutputSchema.safeParse({
      turnId: 'turn-1',
      agentText: '',
      artifact: { title: 'v1' },
      toolCalls: [{ name: 't', serverName: 's', status: 'success' as const }],
      session: validSession,
      turns: [],
    });
    expect(result.success).toBe(true);
  });
});

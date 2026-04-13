import { describe, it, expect } from 'vitest';
import { ConversationTurnSchema, CoworkSessionSchema } from '../cowork-session.js';
import { buildCoworkSession } from '../../testing/factories.js';

describe('ConversationTurnSchema', () => {
  it('should parse a human turn', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-1',
      role: 'human',
      content: 'Hello',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: null,
    });
    expect(result.success).toBe(true);
  });

  it('should parse an agent turn', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-2',
      role: 'agent',
      content: 'Hi there!',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });

  it('should parse a tool turn with all fields', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-3',
      role: 'tool',
      content: '',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: null,
      toolName: 'tealflow__tealflow_list_modules',
      toolArgs: { category: 'safety' },
      toolResult: '["tm_ae_table", "tm_ae_summary"]',
      toolStatus: 'success',
      serverName: 'tealflow',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('tool');
      expect(result.data.toolName).toBe('tealflow__tealflow_list_modules');
      expect(result.data.toolStatus).toBe('success');
      expect(result.data.serverName).toBe('tealflow');
    }
  });

  it('should parse a tool turn with running status', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-4',
      role: 'tool',
      content: '',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: null,
      toolName: 'tealflow__tealflow_list_modules',
      toolArgs: {},
      toolStatus: 'running',
      serverName: 'tealflow',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolStatus).toBe('running');
      expect(result.data.toolResult).toBeUndefined();
    }
  });

  it('should parse a tool turn with error status', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-5',
      role: 'tool',
      content: '',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: null,
      toolName: 'tealflow__broken_tool',
      toolStatus: 'error',
      toolResult: 'Connection refused',
      serverName: 'tealflow',
    });
    expect(result.success).toBe(true);
  });

  it('should still parse human/agent turns without tool fields (backward compat)', () => {
    const result = ConversationTurnSchema.safeParse({
      id: 'turn-6',
      role: 'human',
      content: 'List the modules',
      timestamp: '2025-01-01T00:00:00.000Z',
      artifactDelta: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.toolName).toBeUndefined();
      expect(result.data.toolStatus).toBeUndefined();
    }
  });
});

describe('CoworkSessionSchema with mcpServers', () => {
  it('should parse a session with mcpServers', () => {
    const session = buildCoworkSession({
      mcpServers: [
        { name: 'tealflow', command: 'tealflow-mcp', args: [] },
      ],
    });
    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toHaveLength(1);
      expect(result.data.mcpServers![0].name).toBe('tealflow');
    }
  });

  it('should default mcpServers to null when omitted', () => {
    const session = buildCoworkSession();
    // Remove mcpServers to simulate legacy data
    const { mcpServers: _, ...legacySession } = session;
    const result = CoworkSessionSchema.safeParse(legacySession);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeNull();
    }
  });

  it('should accept explicit null mcpServers', () => {
    const session = buildCoworkSession({ mcpServers: null });
    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeNull();
    }
  });

  it('should parse a session with tool turns in conversation', () => {
    const session = buildCoworkSession({
      turns: [
        {
          id: 'turn-1',
          role: 'human',
          content: 'List available modules',
          timestamp: '2025-01-01T00:00:00.000Z',
          artifactDelta: null,
        },
        {
          id: 'turn-2',
          role: 'tool',
          content: '',
          timestamp: '2025-01-01T00:00:01.000Z',
          artifactDelta: null,
          toolName: 'tealflow__tealflow_list_modules',
          toolArgs: {},
          toolStatus: 'success',
          toolResult: '[{"name": "tm_ae_table"}]',
          serverName: 'tealflow',
        },
        {
          id: 'turn-3',
          role: 'agent',
          content: 'I found the following modules...',
          timestamp: '2025-01-01T00:00:02.000Z',
          artifactDelta: null,
        },
      ],
    });
    const result = CoworkSessionSchema.safeParse(session);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.turns).toHaveLength(3);
      expect(result.data.turns[1].role).toBe('tool');
    }
  });
});

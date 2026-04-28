import { describe, it, expect } from 'vitest';
import { McpServerConfigSchema } from '../mcp-server-config.js';
import { WorkflowAgentConfigSchema, WorkflowCoworkConfigSchema } from '../workflow-definition.js';

describe('McpServerConfigSchema', () => {
  it('should parse a valid stdio MCP server config', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'cdisc-library',
      command: 'npx',
      args: ['-y', '@cdisc/mcp-server'],
      env: { API_KEY: '{{CDISC_API_KEY}}' },
      description: 'CDISC Library API',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('cdisc-library');
      expect(result.data.args).toEqual(['-y', '@cdisc/mcp-server']);
    }
  });

  it('should parse minimal stdio config (name + command only)', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'filesystem',
      command: 'node',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toEqual([]);
      expect(result.data.env).toBeUndefined();
    }
  });

  it('should parse HTTP-only config (url, no command)', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'remote-server',
      url: 'https://mcp.example.com/v1',
      description: 'Remote MCP server via HTTP',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://mcp.example.com/v1');
      expect(result.data.command).toBeUndefined();
    }
  });

  it('should parse config with both command and url', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'hybrid',
      command: 'npx',
      url: 'https://mcp.example.com/v1',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty name', () => {
    const result = McpServerConfigSchema.safeParse({
      name: '',
      command: 'npx',
    });
    expect(result.success).toBe(false);
  });

  it('should reject config with neither command nor url', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid url', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'bad-url',
      url: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });

  it('should parse allowedTools for tool-level filtering', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'github',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      allowedTools: ['search_code', 'get_file_contents'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowedTools).toEqual(['search_code', 'get_file_contents']);
    }
  });

  it('should allow omitting allowedTools (all tools available)', () => {
    const result = McpServerConfigSchema.safeParse({
      name: 'github',
      command: 'npx',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allowedTools).toBeUndefined();
    }
  });
});

describe('WorkflowAgentConfigSchema with mcpServers', () => {
  it('should accept mcpServers array', () => {
    const result = WorkflowAgentConfigSchema.safeParse({
      model: 'sonnet',
      skill: 'extract-data',
      mcpServers: [
        {
          name: 'cdisc-library',
          command: 'node',
          args: ['/opt/mcp/cdisc/index.js'],
          env: { API_KEY: '{{CDISC_API_KEY}}' },
          description: 'CDISC Library API',
        },
        {
          name: 'postgres-readonly',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://ro@host/db'],
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toHaveLength(2);
      expect(result.data.mcpServers![0].name).toBe('cdisc-library');
      expect(result.data.mcpServers![1].name).toBe('postgres-readonly');
    }
  });

  it('should accept agent config without mcpServers', () => {
    const result = WorkflowAgentConfigSchema.safeParse({
      model: 'sonnet',
      skill: 'extract-data',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeUndefined();
    }
  });

  it('should reject invalid mcpServers entries', () => {
    const result = WorkflowAgentConfigSchema.safeParse({
      model: 'sonnet',
      mcpServers: [{ name: '' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('WorkflowCoworkConfigSchema with mcpServers', () => {
  it('should accept cowork config with mcpServers', () => {
    const result = WorkflowCoworkConfigSchema.safeParse({
      agent: 'chat',
      systemPrompt: 'Help the user explore teal modules.',
      mcpServers: [
        {
          name: 'tealflow',
          command: 'tealflow-mcp',
          description: 'Tealflow MCP — teal module discovery',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toHaveLength(1);
      expect(result.data.mcpServers![0].name).toBe('tealflow');
    }
  });

  it('should accept cowork config without mcpServers', () => {
    const result = WorkflowCoworkConfigSchema.safeParse({
      agent: 'chat',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeUndefined();
    }
  });

  it('should accept cowork config with HTTP MCP server', () => {
    const result = WorkflowCoworkConfigSchema.safeParse({
      agent: 'chat',
      mcpServers: [
        {
          name: 'remote-tools',
          url: 'https://mcp.example.com/v1',
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

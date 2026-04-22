import { describe, it, expect } from 'vitest';
import {
  AgentMcpBindingSchema,
  HttpAuthConfigSchema,
  StepMcpRestrictionSchema,
  ToolCatalogEntrySchema,
} from '../agent-mcp-binding.js';
import { AgentDefinitionSchema } from '../agent-definition.js';
import { WorkflowDefinitionSchema } from '../workflow-definition.js';

describe('AgentMcpBindingSchema', () => {
  describe('stdio variant', () => {
    it('parses a valid stdio binding with catalogId', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
        catalogId: 'cdisc-library',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe('stdio');
        if (result.data.type === 'stdio') {
          expect(result.data.catalogId).toBe('cdisc-library');
        }
      }
    });

    it('parses stdio binding with allowedTools', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
        catalogId: 'github',
        allowedTools: ['search_code', 'get_file_contents'],
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'stdio') {
        expect(result.data.allowedTools).toEqual(['search_code', 'get_file_contents']);
      }
    });

    it('rejects stdio binding with inline command field (closes RCE surface)', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
        catalogId: 'cdisc',
        command: 'rm',
        args: ['-rf', '/'],
      });
      // Strict object: unknown keys rejected
      expect(result.success).toBe(false);
    });

    it('rejects stdio binding without catalogId', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
      });
      expect(result.success).toBe(false);
    });

    it('rejects stdio binding with empty catalogId', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
        catalogId: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects stdio binding with empty allowedTools array', () => {
      // An empty allowlist means "zero tools permitted" — indistinguishable
      // from omitting the server entirely. Force authors to omit the field.
      const result = AgentMcpBindingSchema.safeParse({
        type: 'stdio',
        catalogId: 'gh',
        allowedTools: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('http variant', () => {
    it('parses a valid http binding with url only', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'http') {
        expect(result.data.url).toBe('https://mcp.example.com/v1');
      }
    });

    it('parses http binding with auth headers', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: {
          headers: {
            Authorization: 'Bearer {{SECRET:mcp_token}}',
            'X-Workspace': 'acme',
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'http') {
        expect(result.data.auth?.headers?.Authorization).toBe(
          'Bearer {{SECRET:mcp_token}}',
        );
      }
    });

    it('parses http binding with allowedTools', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
        allowedTools: ['fetch'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects http binding without url', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
      });
      expect(result.success).toBe(false);
    });

    it('rejects http binding with non-URL string', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'not-a-url',
      });
      expect(result.success).toBe(false);
    });

    it('rejects http binding with stdio-only catalogId field', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
        catalogId: 'oops',
      });
      expect(result.success).toBe(false);
    });

    it('rejects http binding with empty allowedTools array', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
        allowedTools: [],
      });
      expect(result.success).toBe(false);
    });
  });

  describe('discriminator', () => {
    it('rejects binding without type field', () => {
      const result = AgentMcpBindingSchema.safeParse({
        catalogId: 'cdisc',
      });
      expect(result.success).toBe(false);
    });

    it('rejects binding with unknown type', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'websocket',
        url: 'wss://example.com',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('HttpAuthConfigSchema', () => {
  it('parses empty auth config', () => {
    const result = HttpAuthConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('parses auth with headers map', () => {
    const result = HttpAuthConfigSchema.safeParse({
      headers: { 'X-Api-Key': '{{SECRET:foo}}' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headers?.['X-Api-Key']).toBe('{{SECRET:foo}}');
    }
  });

  it('rejects headers with non-string values', () => {
    const result = HttpAuthConfigSchema.safeParse({
      headers: { 'X-Count': 42 },
    });
    expect(result.success).toBe(false);
  });
});

describe('ToolCatalogEntrySchema', () => {
  it('parses a minimal catalog entry', () => {
    const result = ToolCatalogEntrySchema.safeParse({
      id: 'cdisc-library',
      command: 'npx',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.args).toBeUndefined();
    }
  });

  it('parses a full catalog entry', () => {
    const result = ToolCatalogEntrySchema.safeParse({
      id: 'postgres-readonly',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { PGURL: '{{SECRET:pg_url}}' },
      description: 'Read-only Postgres MCP server',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty id', () => {
    const result = ToolCatalogEntrySchema.safeParse({
      id: '',
      command: 'npx',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty command', () => {
    const result = ToolCatalogEntrySchema.safeParse({
      id: 'cdisc',
      command: '',
    });
    expect(result.success).toBe(false);
  });
});

describe('StepMcpRestrictionSchema', () => {
  it('parses empty restriction map', () => {
    const result = StepMcpRestrictionSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('parses restriction with disable flag', () => {
    const result = StepMcpRestrictionSchema.safeParse({
      github: { disable: true },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github?.disable).toBe(true);
    }
  });

  it('parses restriction with denyTools', () => {
    const result = StepMcpRestrictionSchema.safeParse({
      github: { denyTools: ['delete_repo', 'create_repo'] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github?.denyTools).toEqual(['delete_repo', 'create_repo']);
    }
  });

  it('parses restriction with both disable and denyTools', () => {
    const result = StepMcpRestrictionSchema.safeParse({
      github: { disable: false, denyTools: ['push'] },
      postgres: { disable: true },
    });
    expect(result.success).toBe(true);
  });

  it('rejects restriction with allowTools field (subtractive only)', () => {
    const result = StepMcpRestrictionSchema.safeParse({
      github: { allowTools: ['search'] },
    });
    // Subtractive by shape: any broadening field must be rejected
    expect(result.success).toBe(false);
  });
});

describe('AgentDefinitionSchema with mcpServers', () => {
  const base = {
    id: 'agent-1',
    name: 'Data Extractor',
    iconName: 'bot',
    description: 'Extracts data from clinical documents',
    foundationModel: 'sonnet',
    systemPrompt: 'You are a helpful agent.',
    inputDescription: 'document',
    outputDescription: 'extracted data',
    skillFileNames: [],
    createdAt: '2026-04-22T00:00:00.000Z',
    updatedAt: '2026-04-22T00:00:00.000Z',
  };

  it('parses agent definition without mcpServers', () => {
    const result = AgentDefinitionSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toBeUndefined();
    }
  });

  it('parses agent definition with mixed stdio + http mcpServers', () => {
    const result = AgentDefinitionSchema.safeParse({
      ...base,
      mcpServers: {
        github: { type: 'stdio', catalogId: 'github' },
        cdisc: { type: 'stdio', catalogId: 'cdisc-library', allowedTools: ['search'] },
        remote: {
          type: 'http',
          url: 'https://mcp.example.com/v1',
          auth: { headers: { Authorization: 'Bearer {{SECRET:token}}' } },
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.mcpServers ?? {})).toHaveLength(3);
      expect(result.data.mcpServers?.github?.type).toBe('stdio');
      expect(result.data.mcpServers?.remote?.type).toBe('http');
    }
  });

  it('rejects mcpServers entry with invalid binding', () => {
    const result = AgentDefinitionSchema.safeParse({
      ...base,
      mcpServers: {
        bad: { type: 'stdio' },
      },
    });
    expect(result.success).toBe(false);
  });

  it('defaults kind to "plugin" when omitted (backcompat)', () => {
    const result = AgentDefinitionSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('plugin');
    }
  });

  it('parses cowork-kind agent with runtimeId', () => {
    const result = AgentDefinitionSchema.safeParse({
      ...base,
      kind: 'cowork',
      runtimeId: 'chat',
      mcpServers: {
        tealflow: { type: 'stdio', catalogId: 'tealflow-mcp' },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('cowork');
      expect(result.data.runtimeId).toBe('chat');
    }
  });

  it('rejects unknown kind values', () => {
    const result = AgentDefinitionSchema.safeParse({
      ...base,
      kind: 'daemon',
    });
    expect(result.success).toBe(false);
  });
});

describe('WorkflowDefinitionSchema with step.mcpRestrictions', () => {
  it('parses a workflow whose step carries mcpRestrictions', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test-workflow',
      version: 1,
      steps: [
        {
          id: 'extract',
          name: 'Extract',
          type: 'creation',
          executor: 'agent',
          mcpRestrictions: {
            github: { denyTools: ['delete_repo'] },
            postgres: { disable: true },
          },
        },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'Start' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      const step = result.data.steps[0];
      expect(step.mcpRestrictions?.github?.denyTools).toEqual(['delete_repo']);
      expect(step.mcpRestrictions?.postgres?.disable).toBe(true);
    }
  });

  it('parses a step with agentId pointer', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'test-workflow',
      version: 1,
      steps: [
        {
          id: 'explore',
          name: 'Explore',
          type: 'creation',
          executor: 'cowork',
          agentId: 'tealflow-cowork-chat',
          cowork: { agent: 'chat' },
        },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'Start' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.steps[0].agentId).toBe('tealflow-cowork-chat');
    }
  });

  it('continues to parse workflows without mcpRestrictions (backward-compat)', () => {
    const result = WorkflowDefinitionSchema.safeParse({
      name: 'legacy-workflow',
      version: 1,
      steps: [
        {
          id: 'extract',
          name: 'Extract',
          type: 'creation',
          executor: 'agent',
          agent: {
            model: 'sonnet',
            // Legacy step-level mcpServers still accepted (deprecated)
            mcpServers: [{ name: 'legacy', command: 'legacy-mcp' }],
          },
        },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'Start' }],
    });
    expect(result.success).toBe(true);
  });
});

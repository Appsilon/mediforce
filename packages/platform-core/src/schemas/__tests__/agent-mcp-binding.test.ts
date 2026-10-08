import { describe, it, expect } from 'vitest';
import {
  AgentMcpBindingSchema,
  HttpAgentMcpBindingSchema,
  HttpAuthConfigSchema,
  HttpHeadersAuthSchema,
  HttpOAuthAuthSchema,
  StepMcpRestrictionSchema,
  ToolCatalogEntrySchema,
  HttpToolCatalogEntrySchema,
} from '../agent-mcp-binding';
import { AgentDefinitionSchema } from '../agent-definition';
import { WorkflowDefinitionSchema } from '../workflow-definition';

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
    it('parses an http binding that references a catalog entry', () => {
      const result = AgentMcpBindingSchema.safeParse({ type: 'http', catalogId: 'github-mcp' });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'http') {
        expect(result.data.catalogId).toBe('github-mcp');
      }
    });

    it('parses http binding with allowedTools', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        catalogId: 'github-mcp',
        allowedTools: ['fetch'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects http binding with an inline url (servers live in the catalog)', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        url: 'https://mcp.example.com/v1',
      });
      expect(result.success).toBe(false);
    });

    it('rejects http binding with inline auth', () => {
      const result = HttpAgentMcpBindingSchema.safeParse({
        type: 'http',
        catalogId: 'github-mcp',
        auth: { type: 'oauth', provider: 'github' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects http binding with empty allowedTools array', () => {
      const result = AgentMcpBindingSchema.safeParse({
        type: 'http',
        catalogId: 'github-mcp',
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
  it('parses headers variant', () => {
    const result = HttpAuthConfigSchema.safeParse({
      type: 'headers',
      headers: { 'X-Api-Key': '{{SECRET:foo}}' },
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'headers') {
      expect(result.data.headers['X-Api-Key']).toBe('{{SECRET:foo}}');
    }
  });

  it('parses oauth variant with defaults', () => {
    const result = HttpAuthConfigSchema.safeParse({
      type: 'oauth',
      provider: 'google',
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'oauth') {
      expect(result.data.headerName).toBe('Authorization');
      expect(result.data.headerValueTemplate).toBe('Bearer {token}');
    }
  });

  it('rejects auth without type discriminator', () => {
    const result = HttpAuthConfigSchema.safeParse({
      headers: { 'X-Api-Key': 'v' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects headers with non-string values', () => {
    const result = HttpAuthConfigSchema.safeParse({
      type: 'headers',
      headers: { 'X-Count': 42 },
    });
    expect(result.success).toBe(false);
  });

  it('rejects oauth without provider', () => {
    const result = HttpAuthConfigSchema.safeParse({ type: 'oauth' });
    expect(result.success).toBe(false);
  });

  it('rejects oauth with empty provider', () => {
    const result = HttpAuthConfigSchema.safeParse({ type: 'oauth', provider: '' });
    expect(result.success).toBe(false);
  });

  it('rejects oauth with empty headerName override', () => {
    const result = HttpAuthConfigSchema.safeParse({
      type: 'oauth',
      provider: 'github',
      headerName: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects oauth with rogue fields', () => {
    const result = HttpAuthConfigSchema.safeParse({
      type: 'oauth',
      provider: 'github',
      headers: { Authorization: 'Bearer x' },
    });
    // Strict: `headers` is valid only on the headers variant.
    expect(result.success).toBe(false);
  });
});

describe('HttpHeadersAuthSchema + HttpOAuthAuthSchema (sub-schema exports)', () => {
  it('HttpHeadersAuthSchema requires type=headers', () => {
    expect(HttpHeadersAuthSchema.safeParse({ type: 'headers', headers: {} }).success).toBe(true);
    expect(HttpHeadersAuthSchema.safeParse({ type: 'oauth', provider: 'github' }).success).toBe(false);
  });

  it('HttpOAuthAuthSchema applies default headerName + headerValueTemplate', () => {
    const result = HttpOAuthAuthSchema.safeParse({ type: 'oauth', provider: 'github' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headerName).toBe('Authorization');
      expect(result.data.headerValueTemplate).toBe('Bearer {token}');
    }
  });
});

describe('ToolCatalogEntrySchema', () => {
  describe('stdio variant', () => {
    it('parses a minimal entry', () => {
      const result = ToolCatalogEntrySchema.safeParse({ id: 'cdisc-library', type: 'stdio', command: 'npx' });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === 'stdio') {
        expect(result.data.args).toBeUndefined();
      }
    });

    it('parses a full entry', () => {
      const result = ToolCatalogEntrySchema.safeParse({
        id: 'postgres-readonly',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres'],
        env: { PGURL: '{{SECRET:pg_url}}' },
        description: 'Read-only Postgres MCP server',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty id', () => {
      expect(ToolCatalogEntrySchema.safeParse({ id: '', type: 'stdio', command: 'npx' }).success).toBe(false);
    });

    it('rejects empty command', () => {
      expect(ToolCatalogEntrySchema.safeParse({ id: 'cdisc', type: 'stdio', command: '' }).success).toBe(false);
    });

    it('rejects a url on a stdio entry', () => {
      const result = ToolCatalogEntrySchema.safeParse({
        id: 'cdisc',
        type: 'stdio',
        command: 'npx',
        url: 'https://example.com',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('http variant', () => {
    it('parses an entry with url only', () => {
      const result = ToolCatalogEntrySchema.safeParse({
        id: 'example',
        type: 'http',
        url: 'https://mcp.example.com/v1',
      });
      expect(result.success).toBe(true);
    });

    it('parses headers auth', () => {
      const result = HttpToolCatalogEntrySchema.safeParse({
        id: 'example',
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:mcp_token}}' } },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.auth?.type === 'headers') {
        expect(result.data.auth.headers.Authorization).toBe('Bearer {{SECRET:mcp_token}}');
      }
    });

    it('parses oauth auth with defaults', () => {
      const result = HttpToolCatalogEntrySchema.safeParse({
        id: 'github',
        type: 'http',
        url: 'https://api.github.com/mcp',
        auth: { type: 'oauth', provider: 'github' },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.auth?.type === 'oauth') {
        expect(result.data.auth.headerName).toBe('Authorization');
        expect(result.data.auth.headerValueTemplate).toBe('Bearer {token}');
      }
    });

    it('normalizes legacy { headers } auth shape into discriminated form', () => {
      const result = HttpToolCatalogEntrySchema.safeParse({
        id: 'legacy',
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: { headers: { Authorization: 'Bearer {{SECRET:legacy_tok}}' } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth?.type).toBe('headers');
      }
    });

    it('drops legacy empty auth object ({}) during normalization', () => {
      const result = HttpToolCatalogEntrySchema.safeParse({
        id: 'legacy',
        type: 'http',
        url: 'https://mcp.example.com/v1',
        auth: {},
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.auth).toBeUndefined();
      }
    });

    it('rejects a non-URL string', () => {
      expect(ToolCatalogEntrySchema.safeParse({ id: 'x', type: 'http', url: 'not-a-url' }).success).toBe(false);
    });

    it('rejects a command on an http entry', () => {
      const result = ToolCatalogEntrySchema.safeParse({
        id: 'x',
        type: 'http',
        url: 'https://example.com',
        command: 'npx',
      });
      expect(result.success).toBe(false);
    });
  });

  it('rejects an entry without type', () => {
    expect(ToolCatalogEntrySchema.safeParse({ id: 'cdisc', command: 'npx' }).success).toBe(false);
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
        remote: { type: 'http', catalogId: 'example' },
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
      namespace: 'test',
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
      namespace: 'test',
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
      namespace: 'test',
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
    });
    expect(result.success).toBe(true);
  });
});

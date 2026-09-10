import { describe, it, expect, vi } from 'vitest';
import { ForbiddenError } from '../../../../errors';
import { runPlatformTool } from '../run-platform-tool';
import type { CallerScope } from '../../../../repositories/index';

/** Only the surfaces these tools touch; everything else stays absent so a tool
 *  reaching for more fails the test rather than silently working. */
function buildScope(overrides: Record<string, unknown> = {}): CallerScope {
  return {
    workspaceSecrets: {
      getSecrets: vi.fn().mockResolvedValue({ OPENROUTER_API_KEY: 'sk-live-abc', STUDY_ID: 'CDISCPILOT01' }),
    },
    agentDefinitions: {
      list: vi.fn().mockResolvedValue([
        { id: 'agent-1', name: 'Validator', description: 'Validates', foundationModel: 'anthropic/claude-sonnet-4.6', namespace: 'acme' },
        {
          id: 'agent-2',
          name: 'Issue filer',
          description: 'Files issues',
          foundationModel: 'anthropic/claude-sonnet-4.6',
          namespace: 'acme',
          mcpServers: {
            github: { type: 'stdio', catalogId: 'github' },
            docs: { type: 'http', url: 'https://mcp.example.com/docs' },
          },
        },
      ]),
      create: vi.fn().mockImplementation((input: Record<string, unknown>) =>
        Promise.resolve({ id: 'agent-new', ...input })),
    },
    workspaces: {
      getMembers: vi.fn().mockResolvedValue([
        { uid: 'u1', role: 'owner', joinedAt: '2026-01-01' },
        { uid: 'u2', role: 'member', joinedAt: '2026-01-02' },
      ]),
    },
    // The scoped repo the trigger handler resolves the target workflow through.
    workflowDefinitions: {
      isNameDeleted: vi.fn().mockResolvedValue(false),
      getDefaultVersion: vi.fn().mockResolvedValue(1),
      listVersions: vi.fn().mockResolvedValue([{ name: 'sample-qc-check', version: 1, archived: false }]),
      get: vi.fn().mockResolvedValue({ name: 'sample-qc-check', version: 1, namespace: 'acme', steps: [], transitions: [] }),
    },
    triggers: {
      listByWorkflow: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockImplementation((row: Record<string, unknown>) => Promise.resolve(row)),
    },
    toolCatalog: {
      list: vi.fn().mockResolvedValue([
        { id: 'github', command: 'npx', args: ['-y', 'mcp-github'], description: 'GitHub MCP' },
      ]),
    },
    system: {
      audit: { append: vi.fn().mockResolvedValue(undefined) },
      userDirectory: {
        getUserMetadata: vi.fn().mockResolvedValue({ email: 'a@b.com', displayName: 'A', lastSignInTime: null }),
        getGrantsForUser: vi.fn().mockImplementation((uid: string) => Promise.resolve(
          uid === 'u1'
            ? [{ role: 'data-manager', workflowName: null }, { role: 'reviewer', workflowName: null }]
            : [{ role: 'reviewer', workflowName: null }],
        )),
      },
    },
    caller: {
      kind: 'user',
      userId: 'u1',
      email: 'someone@example.com',
      namespaces: new Set(['acme']),
      namespaceRoles: new Map([['acme', 'owner']]),
      isSystemActor: false,
    },
    ...overrides,
  } as unknown as CallerScope;
}

describe('runPlatformTool', () => {
  it('lists secret names and never their values', async () => {
    // A secret in the conversation is a secret leaked to the model, the
    // provider, and the transcript. The assistant only needs to know which keys
    // exist so it can reference them and say which are missing.
    const result = await runPlatformTool('list_secrets', {}, buildScope(), 'acme');
    expect(result).toEqual({ keys: ['OPENROUTER_API_KEY', 'STUDY_ID'] });
    expect(JSON.stringify(result)).not.toContain('sk-live-abc');
  });

  it('lists the agents a step could point at, with the MCP servers each is bound to', async () => {
    // An MCP reaches a step only through the agent it points at, so the
    // bindings are what decides whether an existing agent can be reused. Listed
    // without them, the assistant could only guess, and guessing means a second
    // agent that does the same thing.
    const result = await runPlatformTool('list_agents', {}, buildScope(), 'acme');
    expect(result).toEqual({
      agents: [
        { id: 'agent-1', name: 'Validator', description: 'Validates', foundationModel: 'anthropic/claude-sonnet-4.6' },
        {
          id: 'agent-2',
          name: 'Issue filer',
          description: 'Files issues',
          foundationModel: 'anthropic/claude-sonnet-4.6',
          mcpServers: { github: 'github', docs: 'https://mcp.example.com/docs' },
        },
      ],
    });
  });

  it('lists the tool catalog an agent can bind to', async () => {
    const result = await runPlatformTool('list_tool_catalog', {}, buildScope(), 'acme');
    expect(result).toEqual({ servers: [{ id: 'github', description: 'GitHub MCP' }] });
  });

  it('lists the roles this workspace grants, with how many people hold each', async () => {
    // A step's `allowedRoles` naming a role nobody holds is a task nobody can
    // claim. The assistant could not check, so it wrote whatever word the
    // person used.
    const result = await runPlatformTool('list_roles', {}, buildScope(), 'acme');
    expect(result).toEqual({
      roles: [
        { role: 'data-manager', heldBy: 1 },
        { role: 'reviewer', heldBy: 2 },
      ],
    });
  });

  it('puts a saved workflow on a schedule', async () => {
    const scope = buildScope();
    const result = await runPlatformTool(
      'create_cron_trigger',
      { schedule: '0 9 * * 1' },
      scope,
      'acme',
      'sample-qc-check',
    );
    expect(result).toEqual({ created: { name: 'schedule', schedule: '0 9 * * 1' } });
  });

  it('says a schedule needs a saved workflow, rather than failing the turn', async () => {
    // A trigger attaches to a registered workflow, and a canvas that has never
    // been saved has none. The turn carries on and the reply says so.
    const result = await runPlatformTool('create_cron_trigger', { schedule: '0 9 * * 1' }, buildScope(), 'acme');
    expect(result).toMatchObject({ needsSave: true });
  });

  it('creates an agent in the workspace being worked in', async () => {
    const scope = buildScope();
    const result = await runPlatformTool('create_agent', {
      name: 'Report writer',
      description: 'Writes the validation report',
      systemPrompt: 'You write reports.',
      foundationModel: 'anthropic/claude-sonnet-4.6',
      inputDescription: 'Findings',
      outputDescription: 'An HTML report',
    }, scope, 'acme');

    expect(result).toMatchObject({ created: { id: 'agent-new', name: 'Report writer' } });
    const created = vi.mocked(scope.agentDefinitions.create).mock.calls[0][0];
    expect(created).toMatchObject({ namespace: 'acme', kind: 'plugin', visibility: 'private' });
  });

  it('reports a refusal as a result, not an exception', async () => {
    // The assistant acts as the person who asked. When they may not do a thing,
    // the turn continues and the model tells them an admin is needed — it does
    // not crash the conversation, and it does not find another way through.
    const scope = buildScope({
      agentDefinitions: { create: vi.fn().mockRejectedValue(new ForbiddenError('Only admins may create agents')) },
    });
    const result = await runPlatformTool('create_agent', {
      name: 'X', description: 'X', systemPrompt: 'X',
      foundationModel: 'anthropic/claude-sonnet-4.6', inputDescription: 'X', outputDescription: 'X',
    }, scope, 'acme');

    expect(result).toEqual({
      error: 'Only admins may create agents',
      needsAdmin: true,
    });
  });

  it('refuses arguments that do not match the tool', async () => {
    const result = await runPlatformTool('create_agent', { name: '' }, buildScope(), 'acme');
    expect(result).toMatchObject({ error: expect.stringContaining('name') });
  });

  it('refuses a tool it does not have', async () => {
    const result = await runPlatformTool('delete_everything', {}, buildScope(), 'acme');
    expect(result).toMatchObject({ error: expect.stringContaining('delete_everything') });
  });
});

describe('runPlatformTool — the Tool Catalog', () => {
  it('adds a server an agent can then bind to', async () => {
    const scope = buildScope({
      caller: { kind: 'user', userId: 'u1', email: 'admin@example.com', isSystemActor: false, namespaces: ['acme'], namespaceRoles: new Map([['acme', 'admin']]) },
      toolCatalog: {
        list: vi.fn().mockResolvedValue([]),
        // The handler refuses to overwrite an existing id, so it looks first.
        getById: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockImplementation((_ns: string, entry: Record<string, unknown>) => Promise.resolve(entry)),
      },
    });

    const result = await runPlatformTool('create_tool_catalog_entry', {
      command: 'npx -y @modelcontextprotocol/server-github',
      description: 'GitHub MCP',
    }, scope, 'acme');

    expect(result).toMatchObject({ created: { id: expect.any(String) } });
  });

  it('tells a member an admin is needed, rather than adding it anyway', async () => {
    // The Tool Catalog is admin-only on the platform. Running as the user is
    // what makes that gate hold for the assistant too.
    const scope = buildScope({
      caller: { kind: 'user', userId: 'u1', email: 'member@example.com', isSystemActor: false, namespaces: ['acme'], namespaceRoles: new Map([['acme', 'member']]) },
      toolCatalog: { list: vi.fn(), getById: vi.fn(), upsert: vi.fn() },
    });

    const result = await runPlatformTool('create_tool_catalog_entry', {
      command: 'npx -y @modelcontextprotocol/server-github',
    }, scope, 'acme');

    expect(result).toMatchObject({ needsAdmin: true });
    expect(vi.mocked(scope.toolCatalog.upsert)).not.toHaveBeenCalled();
  });
});

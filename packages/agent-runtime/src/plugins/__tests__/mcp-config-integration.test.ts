import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import type { ProcessConfig, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin';

type WriteMcpConfigTarget = { writeMcpConfig: (dir: string) => Promise<void> };

function buildMockAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'extract',
    processInstanceId: 'pi-001',
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L2',
    config: {
      processName: 'test-process',
      configName: 'default',
      configVersion: 'v1',
      stepConfigs: [
        {
          stepId: 'extract',
          executorType: 'agent',
          plugin: 'claude-code-agent',
          agentConfig: {
            skill: 'test-skill',
            skillsDir: '/plugins/test/skills',
            image: 'mediforce-agent:test',
          },
        },
      ],
    } satisfies ProcessConfig,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function buildMockWorkflowAgentContext(
  overrides: Partial<WorkflowAgentContext> = {},
): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: 'extract',
    name: 'Extract Step',
    type: 'creation',
    executor: 'agent',
    plugin: 'claude-code-agent',
    agent: {
      skill: 'test-skill',
      skillsDir: '/plugins/test/skills',
      image: 'mediforce-agent:test',
    },
  };

  const workflowDefinition: WorkflowDefinition = {
    name: 'test-workflow',
    version: 1,
    namespace: 'test',
    visibility: 'private',
    steps: [step],
    transitions: [],
  };

  return {
    stepId: 'extract',
    processInstanceId: 'pi-001',
    runNamespace: 'test',
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L2',
    workflowDefinition,
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function buildContextWithMcpServers(
  mcpServers: Array<{
    name: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    allowedTools?: string[];
  }>,
): AgentContext {
  return buildMockAgentContext({
    config: {
      processName: 'test-process',
      configName: 'default',
      configVersion: 'v1',
      stepConfigs: [
        {
          stepId: 'extract',
          executorType: 'agent',
          plugin: 'claude-code-agent',
          agentConfig: {
            skill: 'test-skill',
            skillsDir: '/plugins/test/skills',
            image: 'mediforce-agent:test',
            mcpServers,
          },
        },
      ],
    } as ProcessConfig,
  });
}

describe('writeMcpConfig integration', () => {
  let plugin: ClaudeCodeAgentPlugin;
  let tmpDir: string;

  beforeEach(async () => {
    plugin = new ClaudeCodeAgentPlugin();
    tmpDir = await mkdtemp(join(tmpdir(), 'mcp-config-test-'));
  });

  async function cleanup() {
    await rm(tmpDir, { recursive: true, force: true });
  }

  it('[DATA] writes mcp-config.json with correct structure for multiple servers', async () => {
    const context = buildContextWithMcpServers([
      { name: 'cdisc-library', command: 'node', args: ['/opt/mcp/cdisc.js'] },
      { name: 'postgres-ro', command: 'npx', args: ['-y', '@mcp/server-postgres'] },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { mcpServers: Record<string, { command: string; args: string[] }> };

    expect(parsed.mcpServers).toBeDefined();
    expect(parsed.mcpServers['cdisc-library']).toMatchObject({
      command: 'node',
      args: ['/opt/mcp/cdisc.js'],
    });
    expect(parsed.mcpServers['postgres-ro']).toMatchObject({
      command: 'npx',
      args: ['-y', '@mcp/server-postgres'],
    });

    await cleanup();
  });

  it('[DATA] does NOT write file when no mcpServers configured', async () => {
    const context = buildMockAgentContext();
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const dirContents = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8').catch(() => null);
    expect(dirContents).toBeNull();

    await cleanup();
  });

  it('[DATA] resolves {{SECRET}} from workflowSecrets', async () => {
    const workflowContext = buildMockWorkflowAgentContext({
      workflowSecrets: { MY_TOKEN: 'workflow-secret-token' },
      step: {
        id: 'extract',
        name: 'Extract Step',
        type: 'creation',
        executor: 'agent',
        plugin: 'claude-code-agent',
        agent: {
          skill: 'test-skill',
          skillsDir: '/plugins/test/skills',
          image: 'mediforce-agent:test',
          mcpServers: [
            {
              name: 'secure-server',
              command: 'node',
              args: ['/opt/mcp/server.js'],
              env: { TOKEN: '{{MY_TOKEN}}' },
            },
          ],
        },
      } as unknown as WorkflowStep,
    });
    workflowContext.workflowDefinition.steps[0] = workflowContext.step;

    await plugin.initialize(workflowContext);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.mcpServers['secure-server']?.env?.TOKEN).toBe('workflow-secret-token');

    await cleanup();
  });

  it('[ERROR] throws when {{SECRET}} not in workflow secrets (no process.env fallback)', async () => {
    const context = buildContextWithMcpServers([
      {
        name: 'env-server',
        command: 'node',
        args: ['/opt/mcp/server.js'],
        env: { TOKEN: '{{FALLBACK_TOKEN}}' },
      },
    ]);
    await plugin.initialize(context);

    await expect(
      (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir),
    ).rejects.toThrow(/FALLBACK_TOKEN.*not configured/);

    await cleanup();
  });

  it('[DATA] omits env key when server has no env configured', async () => {
    const context = buildContextWithMcpServers([
      { name: 'no-env-server', command: 'npx', args: ['-y', '@mcp/server-github'] } as const,
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.mcpServers['no-env-server']).toBeDefined();
    expect(parsed.mcpServers['no-env-server']).not.toHaveProperty('env');

    await cleanup();
  });

  it('[DATA] passes through literal env values unchanged', async () => {
    const context = buildContextWithMcpServers([
      {
        name: 'literal-env-server',
        command: 'node',
        args: ['/opt/mcp/server.js'],
        env: { NODE_ENV: 'production', LOG_LEVEL: 'debug' },
      },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
    };

    expect(parsed.mcpServers['literal-env-server']?.env?.NODE_ENV).toBe('production');
    expect(parsed.mcpServers['literal-env-server']?.env?.LOG_LEVEL).toBe('debug');

    await cleanup();
  });

  it('[DATA] includes allowedTools in mcp-config.json when configured', async () => {
    const context = buildContextWithMcpServers([
      {
        name: 'github',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        allowedTools: ['search_code', 'get_file_contents'],
      },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command: string; args: string[]; allowedTools?: string[] }>;
    };

    expect(parsed.mcpServers['github']?.allowedTools).toEqual(['search_code', 'get_file_contents']);

    await cleanup();
  });

  it('[DATA] omits allowedTools when not configured', async () => {
    const context = buildContextWithMcpServers([
      { name: 'no-filter', command: 'node', args: ['/opt/mcp/server.js'] },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, { command: string; args: string[]; allowedTools?: string[] }>;
    };

    expect(parsed.mcpServers['no-filter']).not.toHaveProperty('allowedTools');

    await cleanup();
  });

  it('[DATA] writes url entry (no empty command) for URL-only servers', async () => {
    const context = buildContextWithMcpServers([
      { name: 'remote', url: 'https://mcp.example.com/v1' },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };

    expect(parsed.mcpServers['remote']).toEqual({ type: 'http', url: 'https://mcp.example.com/v1' });
    expect(parsed.mcpServers['remote']).not.toHaveProperty('command');
    expect(parsed.mcpServers['remote']).not.toHaveProperty('args');

    await cleanup();
  });

  it('[DATA] supports mixed stdio and url servers in the same config', async () => {
    const context = buildContextWithMcpServers([
      { name: 'local-stdio', command: 'node', args: ['/opt/mcp/server.js'] },
      { name: 'remote-http', url: 'https://mcp.example.com/v1', allowedTools: ['search'] },
    ]);
    await plugin.initialize(context);

    await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

    const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
    const parsed = JSON.parse(raw) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };

    expect(parsed.mcpServers['local-stdio']).toMatchObject({
      command: 'node',
      args: ['/opt/mcp/server.js'],
    });
    expect(parsed.mcpServers['remote-http']).toMatchObject({
      url: 'https://mcp.example.com/v1',
      allowedTools: ['search'],
    });
    expect(parsed.mcpServers['remote-http']).not.toHaveProperty('command');

    await cleanup();
  });

  describe('resolver-backed (workflow mode with context.resolvedMcpConfig)', () => {
    it('[DATA] serializes resolved stdio + http servers in flat shape', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: {
          servers: {
            tealflow: {
              type: 'stdio',
              command: 'tealflow-mcp',
              args: ['--stdio'],
            },
            remote: {
              type: 'http',
              url: 'https://mcp.example.com/v1',
              allowedTools: ['search'],
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };

      expect(parsed.mcpServers.tealflow).toMatchObject({
        command: 'tealflow-mcp',
        args: ['--stdio'],
      });
      expect(parsed.mcpServers.remote).toMatchObject({
        url: 'https://mcp.example.com/v1',
        allowedTools: ['search'],
      });
      expect(parsed.mcpServers.remote).not.toHaveProperty('command');

      await cleanup();
    });

    it('[DATA] preserves allowedTools trimmed by step-level denyTools', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: {
          servers: {
            github: {
              type: 'stdio',
              command: 'github-mcp',
              allowedTools: ['search_code', 'get_file_contents'],
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { allowedTools?: string[] }>;
      };
      expect(parsed.mcpServers.github?.allowedTools).toEqual([
        'search_code',
        'get_file_contents',
      ]);

      await cleanup();
    });

    it('[DATA] writes nothing when resolved config has no servers (all disabled)', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: { servers: {} },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const contents = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8').catch(
        () => null,
      );
      expect(contents).toBeNull();

      await cleanup();
    });

    it('[DATA] resolver config wins over legacy step.agent.mcpServers', async () => {
      // step.agent.mcpServers carries a legacy entry; resolvedMcpConfig carries
      // the post-refactor binding. The resolver path must take precedence so
      // that once a workflow migrates to agentId, the legacy field is dead weight.
      const context = buildMockWorkflowAgentContext({
        step: {
          id: 'extract',
          name: 'Extract Step',
          type: 'creation',
          executor: 'agent',
          plugin: 'claude-code-agent',
          agent: {
            skill: 'test-skill',
            skillsDir: '/plugins/test/skills',
            image: 'mediforce-agent:test',
            mcpServers: [
              { name: 'should-be-ignored', command: 'legacy-inline' },
            ],
          },
        } as unknown as WorkflowStep,
        resolvedMcpConfig: {
          servers: {
            canonical: { type: 'stdio', command: 'resolver-path' },
          },
        },
      });
      context.workflowDefinition.steps[0] = context.step;

      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers).toHaveProperty('canonical');
      expect(parsed.mcpServers).not.toHaveProperty('should-be-ignored');

      await cleanup();
    });

    it('[DATA] resolves {{SECRET}} templates in resolved stdio env', async () => {
      const context = buildMockWorkflowAgentContext({
        workflowSecrets: { GITHUB_TOKEN: 'gh-secret-value' },
        resolvedMcpConfig: {
          servers: {
            github: {
              type: 'stdio',
              command: 'github-mcp',
              env: { TOKEN: '{{GITHUB_TOKEN}}' },
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { env?: Record<string, string> }>;
      };
      expect(parsed.mcpServers.github?.env?.TOKEN).toBe('gh-secret-value');

      await cleanup();
    });

    // ---- HTTP auth: headers variant (Step-4 silent bug fix) ----
    //
    // Pre-Step 5, `auth.type === 'headers'` existed in the schema + UI but
    // `writeResolvedMcpConfig` dropped it on the floor — the HTTP entry
    // landed in mcp-config.json with `{url, allowedTools?}` only. These
    // tests lock the fix in: headers must reach the output file.
    it('[DATA] emits headers for http auth.type=headers (Step-4 silent bug fix)', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: {
          servers: {
            linear: {
              type: 'http',
              url: 'https://linear.app/mcp',
              auth: {
                type: 'headers',
                headers: { 'X-Linear-Token': 'static-token' },
              },
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { url: string; headers?: Record<string, string> }>;
      };
      expect(parsed.mcpServers.linear).toMatchObject({
        type: 'http',
        url: 'https://linear.app/mcp',
        headers: { 'X-Linear-Token': 'static-token' },
      });

      await cleanup();
    });

    it('[DATA] resolves {{SECRET:...}} templates inside http auth.type=headers values', async () => {
      const context = buildMockWorkflowAgentContext({
        workflowSecrets: { LINEAR_TOKEN: 'resolved-linear-token' },
        resolvedMcpConfig: {
          servers: {
            linear: {
              type: 'http',
              url: 'https://linear.app/mcp',
              auth: {
                type: 'headers',
                headers: { 'X-Linear-Token': '{{SECRET:LINEAR_TOKEN}}' },
              },
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { headers?: Record<string, string> }>;
      };
      expect(parsed.mcpServers.linear?.headers?.['X-Linear-Token']).toBe('resolved-linear-token');

      await cleanup();
    });

    // ---- HTTP auth: oauth variant (Step 5) ----
    //
    // The resolved HTTP entry carries `auth.type === 'oauth'`; the runtime
    // gets the token via `context.oauthTokens[serverName]` (pre-loaded by
    // executeAgentStep). writeMcpConfig synthesizes `{[headerName]: rendered}`.
    it('[DATA] emits oauth-rendered Authorization header from context.oauthTokens', async () => {
      const context = buildMockWorkflowAgentContext({
        oauthTokens: {
          github: {
            accessToken: 'gha_abc123',
            headerName: 'Authorization',
            headerValueTemplate: 'Bearer {token}',
          },
        },
        resolvedMcpConfig: {
          servers: {
            github: {
              type: 'http',
              url: 'https://api.github.com/mcp',
              auth: {
                type: 'oauth',
                provider: 'github',
                headerName: 'Authorization',
                headerValueTemplate: 'Bearer {token}',
              },
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { url: string; headers?: Record<string, string> }>;
      };
      expect(parsed.mcpServers.github).toMatchObject({
        type: 'http',
        url: 'https://api.github.com/mcp',
        headers: { Authorization: 'Bearer gha_abc123' },
      });

      await cleanup();
    });

    it('[DATA] oauth: custom header name + template from context takes precedence', async () => {
      // Binding declared `Authorization: Bearer {token}`, but the connected
      // token carries a custom header override (e.g. different header rotated
      // after connect). writeMcpConfig must trust the pre-loaded bundle so
      // the header shape stays consistent with what was connected.
      const context = buildMockWorkflowAgentContext({
        oauthTokens: {
          notion: {
            accessToken: 'ntn_xyz',
            headerName: 'X-Notion-Token',
            headerValueTemplate: 'Token {token}',
          },
        },
        resolvedMcpConfig: {
          servers: {
            notion: {
              type: 'http',
              url: 'https://api.notion.com/mcp',
              auth: {
                type: 'oauth',
                provider: 'notion',
                headerName: 'Authorization',
                headerValueTemplate: 'Bearer {token}',
              },
            },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { headers?: Record<string, string> }>;
      };
      expect(parsed.mcpServers.notion?.headers).toEqual({ 'X-Notion-Token': 'Token ntn_xyz' });

      await cleanup();
    });

    it('[ERROR] oauth with no token in context throws OAuthTokenUnavailableError', async () => {
      const context = buildMockWorkflowAgentContext({
        // oauthTokens intentionally undefined — simulates "binding saved, not connected yet".
        resolvedMcpConfig: {
          servers: {
            github: {
              type: 'http',
              url: 'https://api.github.com/mcp',
              auth: {
                type: 'oauth',
                provider: 'github',
                headerName: 'Authorization',
                headerValueTemplate: 'Bearer {token}',
              },
            },
          },
        },
      });
      await plugin.initialize(context);

      await expect(
        (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir),
      ).rejects.toThrow(/not connected.*Connect the account via the agent editor/);

      await cleanup();
    });

    it('[DATA] http entry without auth omits headers field entirely', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: {
          servers: {
            public: { type: 'http', url: 'https://open.example.com/mcp' },
          },
        },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers.public).toEqual({ type: 'http', url: 'https://open.example.com/mcp' });
      expect(parsed.mcpServers.public).not.toHaveProperty('headers');

      await cleanup();
    });
  });

  describe('eval trial MCP record/replay (ADR-0023 D6)', () => {
    type CollectTarget = WriteMcpConfigTarget & {
      storeMcpRecordings: (dir: string) => Promise<void>;
      recordMcpReplayMisses: (dir: string) => Promise<void>;
    };
    const tape = { tools: [{ name: 'read_record' }], calls: [] };

    it('[DATA] answers a replayed server from its tape and puts a live one behind the recording proxy', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: {
          servers: {
            edc: { type: 'stdio', command: 'edc-mcp', args: ['--ro'], allowedTools: ['read_record'] },
            meddra: { type: 'stdio', command: 'meddra-mcp', env: { MEDDRA_VERSION: '27.0' } },
            email: { type: 'http', url: 'https://mcp.example.com/email', auth: { type: 'headers', headers: { 'X-Key': 'k-1' } } },
            untouched: { type: 'http', url: 'https://mcp.example.com/other' },
          },
        },
        mcpTapes: { replay: { edc: tape }, record: ['meddra', 'email'], onRecorded: vi.fn() },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const parsed = JSON.parse(await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8')) as {
        mcpServers: Record<string, Record<string, unknown>>;
      };
      expect(parsed.mcpServers.edc).toEqual({
        type: 'stdio', command: 'node',
        args: ['/output/mcp-tape/mcp-tape.mjs', 'replay', '/output/mcp-tape/edc.replay.json', '/output/mcp-tape/edc.misses.jsonl'],
        allowedTools: ['read_record'],
      });
      expect(parsed.mcpServers.meddra).toEqual({
        type: 'stdio', command: 'node',
        args: ['/output/mcp-tape/mcp-tape.mjs', 'record', '/output/mcp-tape/meddra.tape.jsonl', 'meddra-mcp'],
        env: { MEDDRA_VERSION: '27.0' },
      });
      expect(parsed.mcpServers.email).toEqual({
        type: 'stdio', command: 'node',
        args: ['/output/mcp-tape/mcp-tape.mjs', 'record-http', '/output/mcp-tape/email.tape.jsonl', 'https://mcp.example.com/email'],
        env: { MCP_TAPE_HEADERS: JSON.stringify({ 'X-Key': 'k-1' }) },
      });
      expect(parsed.mcpServers.untouched).toEqual({ type: 'http', url: 'https://mcp.example.com/other' });
      expect(JSON.parse(await readFile(join(tmpDir, 'mcp-tape', 'edc.replay.json'), 'utf-8'))).toEqual(tape);
      expect(await readFile(join(tmpDir, 'mcp-tape', 'mcp-tape.mjs'), 'utf-8')).toContain('function replay');

      await cleanup();
    });

    it('[DATA] hands each recorded tape back and puts replay misses into the trajectory once the agent exits', async () => {
      const onRecorded = vi.fn().mockResolvedValue(undefined);
      const record = vi.fn();
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: { servers: { edc: { type: 'stdio', command: 'edc-mcp' }, meddra: { type: 'stdio', command: 'meddra-mcp' } } },
        mcpTapes: { replay: { edc: tape }, record: ['meddra'], onRecorded },
        trajectory: { record },
      });
      await plugin.initialize(context);
      await mkdir(join(tmpDir, 'mcp-tape'));
      await writeFile(join(tmpDir, 'mcp-tape', 'meddra.tape.jsonl'), [
        JSON.stringify({ kind: 'tools', tools: [{ name: 'lookup' }], cursor: null }),
        JSON.stringify({ kind: 'call', tool: 'lookup', arguments: { term: 'Sepsis' }, result: { content: [{ type: 'text', text: '10040047' }] } }),
      ].join('\n'));
      await writeFile(join(tmpDir, 'mcp-tape', 'edc.misses.jsonl'), `${JSON.stringify({ ts: '2026-09-28T10:00:00.000Z', tool: 'read_record', arguments: { subject: '1001' } })}\n`);

      await (plugin as unknown as CollectTarget).storeMcpRecordings(tmpDir);
      await (plugin as unknown as CollectTarget).recordMcpReplayMisses(tmpDir);

      expect(onRecorded).toHaveBeenCalledWith('meddra', {
        tools: [{ name: 'lookup' }],
        calls: [{ tool: 'lookup', arguments: { term: 'Sepsis' }, result: { content: [{ type: 'text', text: '10040047' }] } }],
      });
      expect(record).toHaveBeenCalledWith([
        { ts: '2026-09-28T10:00:00.000Z', type: 'mcp_replay_miss', server: 'edc', tool: 'read_record', input: { subject: '1001' } },
      ]);

      await cleanup();
    });

    it('[ERROR] refuses to drop replay misses when the run keeps no Agent Trajectory to note them in', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: { servers: { edc: { type: 'stdio', command: 'edc-mcp' } } },
        mcpTapes: { replay: { edc: tape }, record: [], onRecorded: vi.fn() },
      });
      await plugin.initialize(context);
      await mkdir(join(tmpDir, 'mcp-tape'));
      await writeFile(join(tmpDir, 'mcp-tape', 'edc.misses.jsonl'), `${JSON.stringify({ ts: '2026-09-28T10:00:00.000Z', tool: 'read_record', arguments: {} })}\n`);

      await expect((plugin as unknown as CollectTarget).recordMcpReplayMisses(tmpDir)).rejects.toThrow(/no Agent Trajectory/);

      await cleanup();
    });

    it('[DATA] gives servers whose names differ only in punctuation files of their own', async () => {
      const context = buildMockWorkflowAgentContext({
        resolvedMcpConfig: { servers: { 'edc.v2': { type: 'stdio', command: 'edc-mcp' }, edc_v2: { type: 'stdio', command: 'edc-mcp' } } },
        mcpTapes: { replay: {}, record: ['edc.v2', 'edc_v2'], onRecorded: vi.fn() },
      });
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const parsed = JSON.parse(await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8')) as {
        mcpServers: Record<string, { args: string[] }>;
      };
      expect(parsed.mcpServers['edc.v2']!.args[2]).toBe('/output/mcp-tape/edc_2e_v2.tape.jsonl');
      expect(parsed.mcpServers.edc_v2!.args[2]).toBe('/output/mcp-tape/edc_5f_v2.tape.jsonl');

      await cleanup();
    });
  });

  describe('legacy path regression (no resolvedMcpConfig)', () => {
    it('[DATA] legacy process-mode agentConfig.mcpServers still produces mcp-config.json', async () => {
      // This is the AgentContext (process-mode) path — never has resolvedMcpConfig
      // and must keep working after Step 2 for non-migrated processConfigs.
      const context = buildContextWithMcpServers([
        { name: 'legacy-stdio', command: 'node', args: ['/opt/mcp/legacy.js'] },
      ]);
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { command: string; args: string[] }>;
      };
      expect(parsed.mcpServers['legacy-stdio']).toMatchObject({
        command: 'node',
        args: ['/opt/mcp/legacy.js'],
      });

      await cleanup();
    });
  });
});

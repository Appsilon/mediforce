import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext, WorkflowAgentContext } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';

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
    steps: [step],
    transitions: [],
    triggers: [{ type: 'manual', name: 'start' }],
  };

  return {
    stepId: 'extract',
    processInstanceId: 'pi-001',
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

  it('[DATA] resolves {{SECRET}} from process.env fallback', async () => {
    const originalEnv = process.env.FALLBACK_TOKEN;
    process.env.FALLBACK_TOKEN = 'env-fallback-token';

    try {
      const context = buildContextWithMcpServers([
        {
          name: 'env-server',
          command: 'node',
          args: ['/opt/mcp/server.js'],
          env: { TOKEN: '{{FALLBACK_TOKEN}}' },
        },
      ]);
      await plugin.initialize(context);

      await (plugin as unknown as WriteMcpConfigTarget).writeMcpConfig(tmpDir);

      const raw = await readFile(join(tmpDir, 'mcp-config.json'), 'utf-8');
      const parsed = JSON.parse(raw) as {
        mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
      };

      expect(parsed.mcpServers['env-server']?.env?.TOKEN).toBe('env-fallback-token');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.FALLBACK_TOKEN;
      } else {
        process.env.FALLBACK_TOKEN = originalEnv;
      }
      await cleanup();
    }
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

    expect(parsed.mcpServers['remote']).toEqual({ url: 'https://mcp.example.com/v1' });
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
});

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedMcpConfig, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import type { EmitPayload, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import type { SpawnCliOptions } from '../base-container-agent-plugin';
import { OpenCodeAgentPlugin } from '../opencode-agent-plugin';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager';

// Issue #1477: an OpenCode step gets what a Claude Code step gets — MCP servers,
// their tool allowlists, Skills, and a warning when a server never connected.

type PluginInternals = {
  prepareOutputDir(dir: string, agentOptions?: SpawnCliOptions): Promise<void>;
  mcpServerStatus(rawStdout: string, outputDir: string): Promise<{ failed: string[]; pending: string[] }>;
  extractErrorFromResult(resultLine: string): string | null;
  resolvedEnv: { vars: Record<string, string> };
};

type OpenCodeConfig = {
  permission: unknown;
  mcp?: Record<string, Record<string, unknown>>;
  skills?: { paths: string[] };
};

function buildContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: 'extract',
    name: 'Extract',
    type: 'creation',
    executor: 'agent',
    plugin: 'opencode-agent',
    agent: { prompt: 'Extract the trial metadata.', image: 'mediforce-agent:test' },
  };
  const workflowDefinition: WorkflowDefinition = {
    name: 'wf', version: 1, namespace: 'test', visibility: 'private', steps: [step], transitions: [],
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

describe('OpenCodeAgentPlugin — Claude Code parity (#1477)', () => {
  let plugin: OpenCodeAgentPlugin;
  let outputDir: string;

  function internals(): PluginInternals {
    return plugin as unknown as PluginInternals;
  }

  async function writtenConfig(agentOptions?: SpawnCliOptions): Promise<OpenCodeConfig> {
    await internals().prepareOutputDir(outputDir, agentOptions);
    return JSON.parse(await readFile(join(outputDir, 'opencode.json'), 'utf-8')) as OpenCodeConfig;
  }

  async function initializeWithServers(servers: ResolvedMcpConfig['servers'], overrides: Partial<WorkflowAgentContext> = {}): Promise<void> {
    await plugin.initialize(buildContext({ resolvedMcpConfig: { servers }, ...overrides }));
  }

  beforeEach(async () => {
    plugin = new OpenCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    outputDir = await mkdtemp(join(tmpdir(), 'opencode-parity-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  describe('MCP servers in opencode.json', () => {
    it('[DATA] translates a stdio server to a local entry and an http server to a remote one', async () => {
      await initializeWithServers({
        biomcp: { type: 'stdio', command: 'uvx', args: ['biomcp-python', 'run'], env: { BIOMCP_MODE: 'stdio' } },
        remote: { type: 'http', url: 'https://mcp.example.com/v1', auth: { type: 'headers', headers: { 'X-Api-Key': 'abc' } } },
      });

      const config = await writtenConfig();

      expect(config.mcp?.biomcp).toEqual({
        type: 'local',
        command: ['uvx', 'biomcp-python', 'run'],
        environment: { BIOMCP_MODE: 'stdio' },
        timeout: 120000,
      });
      expect(config.mcp?.remote).toEqual({
        type: 'remote',
        url: 'https://mcp.example.com/v1',
        headers: { 'X-Api-Key': 'abc' },
        oauth: false,
      });
    });

    it('[DATA] lets MCP_TIMEOUT in the step env set how long a local server may take to start', async () => {
      await initializeWithServers({ biomcp: { type: 'stdio', command: 'uvx' } });
      internals().resolvedEnv = { vars: { MCP_TIMEOUT: '300000' } };

      const config = await writtenConfig();

      expect(config.mcp?.biomcp.timeout).toBe(300000);
    });

    it('[DATA] carries the deprecated inline agentConfig.mcpServers too', async () => {
      const context = buildContext();
      context.step.agent = {
        ...context.step.agent,
        mcpServers: [{ name: 'legacy', command: 'node', args: ['/opt/mcp/server.js'] }],
      };
      await plugin.initialize(context);

      const config = await writtenConfig();

      expect(config.mcp?.legacy).toMatchObject({ type: 'local', command: ['node', '/opt/mcp/server.js'] });
    });

    it('[DATA] starts the record/replay tape in place of a server in an eval trial', async () => {
      await initializeWithServers(
        { edc: { type: 'stdio', command: 'edc-mcp' } },
        { mcpTapes: { replay: { edc: { tools: [], calls: [] } }, record: [], onRecorded: vi.fn() } },
      );

      const config = await writtenConfig();

      expect(config.mcp?.edc.command).toEqual([
        'node', '/output/mcp-tape/mcp-tape.mjs', 'replay', '/output/mcp-tape/edc.replay.json', '/output/mcp-tape/edc.misses.jsonl',
      ]);
    });

    it('[DATA] writes no mcp block when the step binds no server', async () => {
      await plugin.initialize(buildContext());

      const config = await writtenConfig();

      expect(config.mcp).toBeUndefined();
      expect(config.permission).toBe('allow');
    });
  });

  describe('MCP tool allowlist', () => {
    it('[DATA] denies a server\'s other tools when its binding lists allowedTools', async () => {
      await initializeWithServers({
        github: { type: 'stdio', command: 'github-mcp', allowedTools: ['search_code', 'get_file_contents'] },
        biomcp: { type: 'stdio', command: 'uvx' },
      });

      const config = await writtenConfig();

      // OpenCode names an MCP tool `<server>_<tool>`; the last matching rule wins.
      expect(config.permission).toEqual({
        '*': 'allow',
        'github_*': 'deny',
        github_search_code: 'allow',
        github_get_file_contents: 'allow',
        'biomcp_*': 'allow',
      });
    });

    it('[DATA] keeps a restricted server\'s wildcard from denying a longer-named server\'s tools', async () => {
      await initializeWithServers({
        github_enterprise: { type: 'stdio', command: 'ghe-mcp' },
        github: { type: 'stdio', command: 'github-mcp', allowedTools: ['search_*'] },
      });

      const config = await writtenConfig();

      expect(Object.entries(config.permission as Record<string, string>)).toEqual([
        ['*', 'allow'],
        ['github_*', 'deny'],
        ['github_search_*', 'allow'],
        ['github_enterprise_*', 'allow'],
      ]);
    });
  });

  describe('Skills', () => {
    it('[DATA] points OpenCode at the plugin directory\'s skills folder', async () => {
      await plugin.initialize(buildContext());

      const config = await writtenConfig({ pluginDir: '/plugin' });

      expect(config.skills).toEqual({ paths: ['/plugin/skills'] });
    });

    it('[DATA] delivers the agent\'s Skills in the plugin directory instead of dropping them', async () => {
      await plugin.initialize(buildContext({
        agentSkills: [{
          namespace: 'acme', id: 'sdtm-mapping', name: 'sdtm-mapping', description: 'Map raw data to SDTM', visibility: 'private',
          contentHash: `hash-${Date.now()}`,
          files: [{ path: 'SKILL.md', contents: '---\nname: sdtm-mapping\ndescription: Map raw data to SDTM\n---\n# SDTM\n' }],
          createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z',
        }],
      }));

      const pluginDir = await (plugin as unknown as { resolvePluginDir(skillsDir: undefined, resolve: (path: string) => string): Promise<string | undefined> })
        .resolvePluginDir(undefined, (path) => path);

      expect(pluginDir).toBeDefined();
      expect(await readFile(join(pluginDir!, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf-8')).toContain('# SDTM');
    });
  });

  describe('MCP startup status', () => {
    async function writeOpenCodeLog(lines: string[]): Promise<void> {
      const logDir = join(outputDir, '.local', 'share', 'opencode', 'log');
      await mkdir(logDir, { recursive: true });
      await writeFile(join(logDir, '2026-10-07T091741.log'), `${lines.join('\n')}\n`);
    }

    it('[DATA] reports every server OpenCode found but never connected as failed', async () => {
      await initializeWithServers({
        broken: { type: 'stdio', command: 'false' },
        everything: { type: 'stdio', command: 'npx' },
        remote: { type: 'http', url: 'http://127.0.0.1:9/mcp' },
      });
      await writeOpenCodeLog([
        'INFO  2026-10-07T09:17:42 +2ms service=mcp key=broken type=local found',
        'INFO  2026-10-07T09:17:42 +4ms service=mcp key=everything type=local found',
        'INFO  2026-10-07T09:17:42 +4ms service=mcp key=remote type=remote found',
        'ERROR 2026-10-07T09:17:42 +10ms service=mcp key=broken command=["false"] cwd=/workspace error=MCP error -32000: Connection closed local mcp startup failed',
        'INFO  2026-10-07T09:18:19 +43ms service=mcp key=everything toolCount=13 create() successfully created client',
      ]);

      const status = await internals().mcpServerStatus('', outputDir);

      expect(status).toEqual({ failed: ['broken', 'remote'], pending: [] });
    });

    it('[DATA] reads the failed servers from the log format OpenCode 1.17 writes', async () => {
      await initializeWithServers({
        biomcp: { type: 'stdio', command: 'uvx' },
        broken: { type: 'stdio', command: 'false' },
        deepwiki: { type: 'http', url: 'https://mcp.deepwiki.com/mcp' },
      });
      await writeOpenCodeLog([
        'timestamp=2026-10-07T09:30:43.953Z level=WARN run=a20f5489 message="server unavailable" key=broken type=local status=failed',
        'timestamp=2026-10-07T09:31:43.948Z level=WARN run=a20f5489 message="server unavailable" key=biomcp type=local status=failed',
        'timestamp=2026-10-07T09:31:43.985Z level=INFO run=a20f5489 message=init count=2',
      ]);

      const status = await internals().mcpServerStatus('', outputDir);

      expect(status).toEqual({ failed: ['broken', 'biomcp'], pending: [] });
    });

    it('[DATA] reports nothing when OpenCode left no log to read', async () => {
      await initializeWithServers({ biomcp: { type: 'stdio', command: 'uvx' } });

      const status = await internals().mcpServerStatus('', outputDir);

      expect(status).toEqual({ failed: [], pending: [] });
    });

    it('[DATA] warns on the run, with the image hint, when a stdio server failed to start', async () => {
      await initializeWithServers({ biomcp: { type: 'stdio', command: 'uvx' } });
      const events: EmitPayload[] = [];
      vi.spyOn(plugin as unknown as { spawnDockerContainer: () => Promise<unknown> }, 'spawnDockerContainer').mockResolvedValue({
        cliOutput: JSON.stringify({ result: JSON.stringify({ confidence: 0.9 }) }),
        failedMcpServers: ['biomcp'],
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output',
        injectedEnvVars: [],
      });

      await plugin.run(async (event) => { events.push(event); });

      const warnings = events.filter((event) => event.type === 'status' && String(event.payload).includes('MCP server'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].payload).toContain("MCP server 'biomcp' failed to start");
      expect(warnings[0].payload).toContain('OpenCode waits at most 60s for a server to start');
      expect(warnings[0].payload).not.toContain('MCP_TIMEOUT');
    });
  });

  describe('error detail', () => {
    it('[DATA] surfaces the OpenCode error event as the failure detail', async () => {
      await plugin.initialize(buildContext());
      const stdout = JSON.stringify({ type: 'error', error: { name: 'APIError', data: { message: 'Missing Authentication header' } } });

      const detail = internals().extractErrorFromResult(plugin.parseAgentOutput(stdout));

      expect(detail).toBe('Missing Authentication header');
    });

    it('[DATA] has no error detail for a normal answer', async () => {
      await plugin.initialize(buildContext());
      const stdout = JSON.stringify({ type: 'text', part: { type: 'text', text: 'done' } });

      expect(internals().extractErrorFromResult(plugin.parseAgentOutput(stdout))).toBeNull();
    });
  });
});

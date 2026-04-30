import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager.js';

type DockerResult = { cliOutput: string; gitMetadata: null; presentation: string | null; outputDir: string; injectedEnvVars: string[] };
type SpawnDockerTarget = { spawnDockerContainer: (prompt: string, options?: Record<string, unknown>) => Promise<DockerResult> };
type ReadSkillTarget = { readSkillFile: (skillsDir: string, skill: string) => Promise<string> };

// Ensure ALLOW_LOCAL_AGENTS is not set during tests (unless explicitly set in a test)
const originalAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
beforeEach(() => {
  delete process.env.ALLOW_LOCAL_AGENTS;
});
afterAll(() => {
  if (originalAllowLocal !== undefined) {
    process.env.ALLOW_LOCAL_AGENTS = originalAllowLocal;
  }
});

function mockSpawn(plugin: ClaudeCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as SpawnDockerTarget, 'spawnDockerContainer');
}

function mockReadSkill(plugin: ClaudeCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as ReadSkillTarget, 'readSkillFile');
}

function buildMockContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'extract',
    processInstanceId: 'pi-001',
    definitionVersion: 'v1',
    stepInput: { filePaths: ['/data/protocol.pdf', '/data/sap.pdf'] },
    autonomyLevel: 'L2',
    config: {
      processName: 'protocol-to-tfl',
      configName: 'default',
      configVersion: 'v1',
      stepConfigs: [
        {
          stepId: 'extract',
          executorType: 'agent',
          plugin: 'claude-code-agent',
          agentConfig: {
            skill: 'trial-metadata-extractor',
            skillsDir: '/plugins/protocol-to-tfl/skills',
            image: 'mediforce-agent:protocol-to-tfl',
          },
        },
      ],
    } satisfies ProcessConfig,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function buildEmitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => {
    events.push(event);
  });
  return { emit, events };
}

describe('ClaudeCodeAgentPlugin', () => {
  let plugin: ClaudeCodeAgentPlugin;

  beforeEach(() => {
    plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
  });

  describe('initialize', () => {
    it('[DATA] stores context and extracts skill from agentConfig', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);
      expect(() => plugin.initialize(context)).not.toThrow();
    });

    it('[DATA] accepts prompt-only config without skill', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                prompt: 'Extract metadata from the uploaded PDF files',
                image: 'mediforce-agent:protocol-to-tfl',
              },
            },
          ],
        },
      });
      await expect(plugin.initialize(context)).resolves.toBeUndefined();
    });

    it('[ERROR] throws if neither skill nor prompt configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: { image: 'mediforce-agent:protocol-to-tfl' },
            },
          ],
        },
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/skill.*prompt/i);
    });

    it('[ERROR] throws if no Docker image and local execution not allowed', async () => {
      delete process.env.ALLOW_LOCAL_AGENTS;
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
              },
            },
          ],
        } satisfies ProcessConfig,
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/ALLOW_LOCAL_AGENTS/i);
    });

    it('[DATA] allows no image when ALLOW_LOCAL_AGENTS=true', async () => {
      process.env.ALLOW_LOCAL_AGENTS = 'true';
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
              },
            },
          ],
        } satisfies ProcessConfig,
      });
      await expect(plugin.initialize(context)).resolves.toBeUndefined();
    });

    it('[ERROR] throws if stepConfig not found for stepId', async () => {
      const context = buildMockContext({
        stepId: 'nonexistent-step',
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            { stepId: 'extract', executorType: 'agent' },
          ],
        },
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/step.*config/i);
    });
  });

  describe('run', () => {
    it('[DATA] emits status event before spawning CLI', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor\nExtract metadata...');
      mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: 'extracted metadata', confidence: 0.85 }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toContain('trial-metadata-extractor');
    });

    it('[DATA] builds prompt from SKILL.md content and input data', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor\nExtract metadata from docs.');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Trial Metadata Extractor');
      expect(prompt).toContain('/data/protocol.pdf');
      expect(prompt).toContain('/data/sap.pdf');
    });

    it('[DATA] appends custom prompt to skill prompt when both provided', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                prompt: 'Focus on endpoints and safety data only',
                image: 'mediforce-agent:protocol-to-tfl',
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({ cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Trial Metadata Extractor');
      expect(prompt).toContain('Focus on endpoints and safety data only');
    });

    it('[DATA] uses prompt-only when no skill is configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                prompt: 'Analyze these PDF files and extract key data',
                image: 'mediforce-agent:protocol-to-tfl',
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({ cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Analyze these PDF files');
      expect(prompt).toContain('/data/protocol.pdf');
    });

    it('[DATA] passes model option to CLI when configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                model: 'sonnet',
                image: 'mediforce-agent:protocol-to-tfl',
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({ cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] });

      await plugin.run(emit);

      const [, options] = spawnSpy.mock.calls[0];
      expect(options).toMatchObject({ model: 'sonnet' });
    });

    it('[DATA] emits result with valid AgentOutputEnvelope', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: 'extracted data', confidence: 0.9 }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBeTypeOf('number');
      expect(payload.reasoning_summary).toBeTypeOf('string');
      expect(payload.reasoning_chain).toBeInstanceOf(Array);
      expect(payload.annotations).toBeInstanceOf(Array);
      expect(payload.duration_ms).toBeTypeOf('number');
      expect(payload.result).toBeDefined();
    });

    it('[DATA] includes confidence_rationale from agent output in envelope', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: { ok: true }, confidence: 0.72, confidence_rationale: 'Missing supplier X data — interpolated from similar category.' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence_rationale).toBe('Missing supplier X data — interpolated from similar category.');
    });

    it('[DATA] omits confidence_rationale from envelope when agent does not provide it', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: { ok: true }, confidence: 0.9 }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('confidence_rationale');
    });

    it('[DATA] includes confidence self-assessment instructions in prompt', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const promptArg = spawnSpy.mock.calls[0][0] as string;
      expect(promptArg).toContain('Confidence Self-Assessment');
      expect(promptArg).toContain('confidence_rationale');
      expect(promptArg).toContain('100 cases like this');
    });

    it('[DATA] accepts standalone Docker mode (image only, no repo/commit)', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                image: 'mediforce-agent:protocol-to-tfl',
                // no repo or commit — standalone mode
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor\nExtract metadata...');
      mockSpawn(plugin).mockResolvedValue(
        { cliOutput: JSON.stringify({ result: 'standalone output', confidence: 0.85 }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] },
      );

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBeTypeOf('number');
      expect(payload.confidence).toBeGreaterThan(0);
    });

    it('[DATA] resolves output_file from Docker /output mount to host path', async () => {
      // Simulate: agent writes JSON to /output/result.json inside Docker,
      // which maps to a host temp dir via the volume mount.
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-output-'));
      const metadata = {
        study_id: 'CDISCPILOT01',
        phase: 'Phase II',
        endpoints: ['ADAS-Cog 11', 'CIBIC+'],
        confidence: 0.92,
      };
      await writeFile(join(hostOutputDir, 'trial-metadata.json'), JSON.stringify(metadata));

      const agentResponse = JSON.stringify({
        output_file: '/output/trial-metadata.json',
        summary: 'Extracted trial metadata for CDISCPILOT01',
      });
      const streamJson = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: agentResponse,
      });

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: streamJson,
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir,
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      // The actual metadata should be resolved, not { raw: "..." }
      expect(result.study_id).toBe('CDISCPILOT01');
      expect(result.phase).toBe('Phase II');
      expect(result.endpoints).toEqual(['ADAS-Cog 11', 'CIBIC+']);
      expect(result.summary).toBe('Extracted trial metadata for CDISCPILOT01');
      expect(result).not.toHaveProperty('raw');

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[DATA] falls back to raw when output_file is missing from host', async () => {
      // Agent references a file that doesn't exist on the host
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-output-'));

      const agentResponse = JSON.stringify({
        output_file: '/output/nonexistent.json',
        summary: 'Some summary',
      });
      const streamJson = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: agentResponse,
      });

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: streamJson,
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir,
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      // Should fall back to raw + summary
      expect(result.raw).toBe(agentResponse);
      expect(result.summary).toBe('Some summary');

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[DATA] prompt uses /output as output dir in Docker mode', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output',
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      // Docker mode should tell agent to write to /output, not a host temp path
      expect(prompt).toContain('/output');
      expect(prompt).not.toMatch(/\/private\/var\/folders/);
      expect(prompt).not.toMatch(/\/tmp\/mediforce-agent-/);
    });

    it('[ERROR] re-throws errors and emits error event (not fake result)', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockRejectedValue(
        new Error('CLI process exited with code 1'),
      );

      await expect(plugin.run(emit)).rejects.toThrow('CLI process exited with code 1');

      // Error event emitted for observability
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.payload as Record<string, unknown>).error).toContain('CLI process exited with code 1');

      // Must NOT emit a result event — that fools the runner into treating failures as success
      expect(events.find((e) => e.type === 'result')).toBeUndefined();
    });

    it('[DATA] includes previous step outputs in prompt context', async () => {
      const previousOutputs = { uploadedFiles: ['file1.pdf', 'file2.pdf'] };
      const context = buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue(previousOutputs),
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({ cliOutput: JSON.stringify({ result: 'ok' }), gitMetadata: null, presentation: null, outputDir: '/tmp/mock-output', injectedEnvVars: [] });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('file1.pdf');
      expect(prompt).toContain('file2.pdf');
    });

    it('[DATA] includes presentation in emitted result when spawn provides it', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill content');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok', confidence: 0.9 }),
        gitMetadata: null,
        presentation: '<h1>My Report</h1>',
        outputDir: '/tmp/mock-output',
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.presentation).toBe('<h1>My Report</h1>');
    });

    it('[DATA] omits presentation from result when spawn returns null', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill content');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok', confidence: 0.9 }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output',
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.presentation).toBeUndefined();
    });

    it('[DATA] emits MCP servers status event when mcpServers configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                image: 'mediforce-agent:protocol-to-tfl',
                mcpServers: [
                  { name: 'cdisc-library', command: 'node', args: ['/opt/mcp/cdisc.js'] },
                  { name: 'postgres-ro', command: 'npx', args: ['-y', '@mcp/server-postgres'] },
                ],
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output',
        injectedEnvVars: [],
      });

      await plugin.run(emit);

      const mcpEvent = events.find(
        (e) => e.type === 'status' && typeof e.payload === 'string' && e.payload.includes('MCP servers'),
      );
      expect(mcpEvent).toBeDefined();
      expect(mcpEvent!.payload).toContain('cdisc-library');
      expect(mcpEvent!.payload).toContain('postgres-ro');
    });
  });

  describe('getAgentCommand', () => {
    it('[DATA] includes --mcp-config flag when mcpServers configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'claude-code-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                image: 'mediforce-agent:protocol-to-tfl',
                mcpServers: [
                  { name: 'github', command: 'npx', args: ['-y', '@mcp/server-github'] },
                ],
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const spec = plugin.getAgentCommand('/output/prompt.txt');
      expect(spec.args).toContain('--mcp-config');
      expect(spec.args).toContain('/output/mcp-config.json');
    });

    it('[DATA] omits --mcp-config flag when no mcpServers configured', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const spec = plugin.getAgentCommand('/output/prompt.txt');
      expect(spec.args).not.toContain('--mcp-config');
    });
  });
});

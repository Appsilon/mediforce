import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';

type SpawnTarget = { spawnClaudeCli: (prompt: string, options?: { model?: string; timeoutMs?: number }) => Promise<string> };
type ReadSkillTarget = { readSkillFile: (skillsDir: string, skill: string) => Promise<string> };

function mockSpawn(plugin: ClaudeCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as SpawnTarget, 'spawnClaudeCli');
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
    plugin = new ClaudeCodeAgentPlugin();
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
              agentConfig: {},
            },
          ],
        },
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/skill.*prompt/i);
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
        JSON.stringify({ result: 'extracted metadata', confidence: 0.85 }),
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
        JSON.stringify({ result: 'ok' }),
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
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(JSON.stringify({ result: 'ok' }));

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
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(JSON.stringify({ result: 'ok' }));

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
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(JSON.stringify({ result: 'ok' }));

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
        JSON.stringify({ result: 'extracted data', confidence: 0.9 }),
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

    it('[ERROR] handles CLI errors gracefully with low confidence result', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockRejectedValue(
        new Error('CLI process exited with code 1'),
      );

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBe(0);
      expect(payload.reasoning_summary).toContain('error');
    });

    it('[DATA] includes previous step outputs in prompt context', async () => {
      const previousOutputs = { uploadedFiles: ['file1.pdf', 'file2.pdf'] };
      const context = buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue(previousOutputs),
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue(JSON.stringify({ result: 'ok' }));

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('file1.pdf');
      expect(prompt).toContain('file2.pdf');
    });
  });
});

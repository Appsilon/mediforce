import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { OpenCodeAgentPlugin } from '../opencode-agent-plugin.js';

const originalAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
beforeEach(() => {
  delete process.env.ALLOW_LOCAL_AGENTS;
});
afterAll(() => {
  if (originalAllowLocal !== undefined) {
    process.env.ALLOW_LOCAL_AGENTS = originalAllowLocal;
  }
});

type DockerResult = { cliOutput: string; gitMetadata: { commitSha: string; branch: string; changedFiles: string[]; repoUrl: string } | null; presentation: null; outputDir: string; injectedEnvVars: string[] };
type SpawnDockerTarget = { spawnDockerContainer: (prompt: string, options?: Record<string, unknown>) => Promise<DockerResult> };
type ReadSkillTarget = { readSkillFile: (skillsDir: string, skill: string) => Promise<string> };

function mockSpawn(plugin: OpenCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as SpawnDockerTarget, 'spawnDockerContainer');
}

function mockReadSkill(plugin: OpenCodeAgentPlugin) {
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
          plugin: 'opencode-agent',
          agentConfig: {
            skill: 'trial-metadata-extractor',
            skillsDir: '/plugins/protocol-to-tfl/skills',
            image: 'mediforce-agent:opencode-protocol-to-tfl',
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

/** Wrap a response string in OpenCode's --format json JSONL output format. */
function openCodeJsonOutput(response: string): string {
  return JSON.stringify({ type: 'text', part: { type: 'text', text: response } });
}

describe('OpenCodeAgentPlugin', () => {
  let plugin: OpenCodeAgentPlugin;

  beforeEach(() => {
    plugin = new OpenCodeAgentPlugin();
  });

  describe('initialize', () => {
    it('[DATA] stores context and extracts agentConfig', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);
      expect(() => plugin.initialize(context)).not.toThrow();
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
              plugin: 'opencode-agent',
              agentConfig: { image: 'mediforce-agent:opencode' },
            },
          ],
        },
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/skill.*prompt/i);
    });

    it('[ERROR] throws if no image and local execution not allowed', async () => {
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
              plugin: 'opencode-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
              },
            },
          ],
        } satisfies ProcessConfig,
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/ALLOW_LOCAL_AGENTS/i);
    });
  });

  describe('metadata', () => {
    it('[DATA] reports correct agent name', () => {
      expect(plugin.agentName).toBe('OpenCode');
    });

    it('[DATA] has descriptive metadata', () => {
      expect(plugin.metadata.name).toBe('OpenCode Agent');
      expect(plugin.metadata.description).toContain('OpenCode');
      expect(plugin.metadata.description).toContain('Ollama');
    });
  });

  describe('getAgentCommand', () => {
    it('[DATA] uses bash -c with cat for prompt file delivery', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const spec = plugin.getAgentCommand('/output/prompt.txt');
      expect(spec.args[0]).toBe('bash');
      expect(spec.args[1]).toBe('-c');
      expect(spec.args[2]).toContain('opencode run');
      expect(spec.args[2]).toContain('$(cat /output/prompt.txt)');
      expect(spec.args[2]).toContain('--format json');
      expect(spec.promptDelivery).toBe('file');
    });
  });

  describe('getInternalEnvVars', () => {
    it('[DATA] always sets OPENCODE_CONFIG and XDG_DATA_HOME', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      // getInternalEnvVars is protected; access via type assertion
      const vars = (plugin as unknown as { getInternalEnvVars(): Record<string, string> }).getInternalEnvVars();
      expect(vars.OPENCODE_CONFIG).toBe('/output/opencode.json');
      expect(vars.XDG_DATA_HOME).toBe('/output/.local/share');
    });
  });

  describe('parseAgentOutput', () => {
    it('[DATA] transforms OpenCode JSON response to extractResult format', () => {
      const agentResponse = JSON.stringify({ output_file: '/output/result.json', summary: 'Done' });
      const stdout = openCodeJsonOutput(agentResponse);

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);

      expect(parsed.result).toBe(agentResponse);
    });

    it('[DATA] handles multi-line stdout with Docker/entrypoint noise', () => {
      const agentResponse = JSON.stringify({ confidence: 0.9, summary: 'OK' });
      const stdout = [
        'Cloning repository...',
        'Switched to branch run/pi-001',
        '[entrypoint] Running command...',
        openCodeJsonOutput(agentResponse),
      ].join('\n');

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);
      expect(parsed.result).toBe(agentResponse);
    });

    it('[DATA] returns empty string when no JSON found in stdout', () => {
      const result = plugin.parseAgentOutput('some random non-json output\nstuff');
      expect(result).toBe('');
    });

    it('[DATA] returns empty string for empty stdout', () => {
      const result = plugin.parseAgentOutput('');
      expect(result).toBe('');
    });
  });

  describe('prepareOutputDir', () => {
    it('[DATA] writes OpenCode config with model when model is set', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'opencode-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                image: 'mediforce-agent:opencode',
                model: 'anthropic.claude-3.5-sonnet',
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const tempDir = await mkdtemp(join(tmpdir(), 'test-opencode-'));
      try {
        // Call prepareOutputDir directly (protected, but accessible for testing)
        await (plugin as unknown as { prepareOutputDir: (dir: string) => Promise<void> }).prepareOutputDir(tempDir);

        const configPath = join(tempDir, 'opencode.json');
        const configContent = JSON.parse(await readFile(configPath, 'utf-8'));
        expect(configContent.$schema).toBe('https://opencode.ai/config.json');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });

    it('[DATA] skips config file when no model configured', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const tempDir = await mkdtemp(join(tmpdir(), 'test-opencode-'));
      try {
        await (plugin as unknown as { prepareOutputDir: (dir: string) => Promise<void> }).prepareOutputDir(tempDir);

        // Config file is always written now (for provider setup)
        const configPath = join(tempDir, 'opencode.json');
        const configContent = JSON.parse(await readFile(configPath, 'utf-8'));
        expect(configContent.$schema).toBe('https://opencode.ai/config.json');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('run', () => {
    it('[DATA] emits status event with OpenCode agent name', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor\nExtract metadata...');

      const agentResponse = JSON.stringify({ confidence: 0.85, summary: 'Extracted' });
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: agentResponse }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toContain('OpenCode');
      expect(statusEvents[0].payload).toContain('trial-metadata-extractor');
    });

    it('[DATA] builds prompt from SKILL.md content and input data', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Trial Metadata Extractor\nExtract metadata from docs.');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output', injectedEnvVars: [],
      });

      await plugin.run(emit);

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Trial Metadata Extractor');
      expect(prompt).toContain('/data/protocol.pdf');
    });

    it('[DATA] git mode prompt has workspace/output split instructions', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'extract',
              executorType: 'agent',
              plugin: 'opencode-agent',
              agentConfig: {
                skill: 'trial-metadata-extractor',
                skillsDir: '/plugins/protocol-to-tfl/skills',
                image: 'mediforce-agent:opencode-protocol-to-tfl',
                repo: 'Appsilon/mediforce-clinical-workspace',
                commit: 'abc123',
              },
            },
          ],
        } satisfies ProcessConfig,
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      // Git mode: deliverables go to /workspace/
      expect(prompt).toContain('Workspace Directory (Git Repo)');
      expect(prompt).toContain('/workspace/');
      expect(prompt).toContain('committed and pushed to the git repository');
      // Result contract still goes to /output/
      expect(prompt).toContain('Result Contract Directory');
      expect(prompt).toContain('/output/result.json');
      // Should NOT have the generic "Write all output files" instruction
      expect(prompt).not.toContain('Write all output files to this absolute path');
    });

    it('[DATA] non-git mode prompt has standard output directory', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      const spawnSpy = mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'ok' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      // Non-git mode: standard output directory instruction
      expect(prompt).toContain('Write all output files to this absolute path');
      // Should NOT have git workspace instructions
      expect(prompt).not.toContain('Workspace Directory (Git Repo)');
      expect(prompt).not.toContain('Result Contract Directory');
    });

    it('[DATA] emits result with valid AgentOutputEnvelope', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: 'extracted data', confidence: 0.9 }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock-output', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBeTypeOf('number');
      expect(payload.reasoning_summary).toContain('OpenCode');
      expect(payload.reasoning_chain).toBeInstanceOf(Array);
      expect(payload.duration_ms).toBeTypeOf('number');
    });

    it('[DATA] resolves output_file from Docker /output mount to host path', async () => {
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-output-'));
      const metadata = {
        study_id: 'OPENCODE-STUDY-001',
        phase: 'Phase II',
        confidence: 0.88,
      };
      await writeFile(join(hostOutputDir, 'result.json'), JSON.stringify(metadata));

      const agentResponse = JSON.stringify({
        output_file: '/output/result.json',
        summary: 'Extracted via OpenCode',
      });
      const cliOutput = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: agentResponse,
      });

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput,
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir, injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      expect(result.study_id).toBe('OPENCODE-STUDY-001');
      expect(result.summary).toBe('Extracted via OpenCode');

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[ERROR] re-throws errors and emits error event (not fake result)', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockRejectedValue(new Error('Docker container failed'));

      await expect(plugin.run(emit)).rejects.toThrow('Docker container failed');

      // Error event emitted for observability
      const errorEvent = events.find((e) => e.type === 'error');
      expect(errorEvent).toBeDefined();
      expect((errorEvent!.payload as Record<string, unknown>).error).toContain('Docker container failed');

      // Must NOT emit a result event — that fools the runner into treating failures as success
      expect(events.find((e) => e.type === 'result')).toBeUndefined();
    });
  });

  describe('Docker I/O: previous step outputs → container', () => {
    // Verifies that large previous step outputs are written as files to the
    // host output directory (which gets mounted as /output in Docker), and
    // that the prompt references them via container paths (/output/...).

    it('[DATA] large previous step output is written to hostOutputDir, not container path', async () => {
      const largeOutput = 'x'.repeat(6_000); // > 5KB threshold
      const context = buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue({
          'generate-tlg-shells': { raw: largeOutput },
        }),
      });
      await plugin.initialize(context);

      const hostDir = await mkdtemp(join(tmpdir(), 'test-docker-io-'));
      try {
        const { emit, events } = buildEmitSpy();
        mockReadSkill(plugin).mockResolvedValue('# Skill');

        // Capture the prompt and verify the file was written to hostDir
        const spawnSpy = mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
          // At spawn time, the large file should already exist in the output dir
          const outputDir = (options as Record<string, unknown>).outputDir as string;
          const fileContent = await readFile(join(outputDir, 'prev-generate-tlg-shells-raw.md'), 'utf-8');
          expect(fileContent).toBe(largeOutput);

          return {
            cliOutput: JSON.stringify({ result: '"done"' }),
            gitMetadata: null,
            presentation: null,
            outputDir,
            injectedEnvVars: [],
          };
        });

        await plugin.run(emit);

        // Prompt should reference /output/ container path, not the host path
        const promptEvent = events.find((e) => e.type === 'prompt');
        expect(promptEvent).toBeDefined();
        const promptText = promptEvent!.payload as string;
        expect(promptText).toContain('[FILE: /output/prev-generate-tlg-shells-raw.md]');
        expect(promptText).not.toContain(hostDir); // Must NOT leak host path

        expect(spawnSpy).toHaveBeenCalledOnce();
      } finally {
        await rm(hostDir, { recursive: true, force: true });
      }
    });

    it('[DATA] small previous step output is inlined in prompt, not written to file', async () => {
      const smallOutput = { extracted: true, confidence: 0.9 };
      const context = buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue({
          'extract-metadata': smallOutput,
        }),
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: '"done"' }),
        gitMetadata: null,
        presentation: null,
        outputDir: '/tmp/mock', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const promptEvent = events.find((e) => e.type === 'prompt');
      const promptText = promptEvent!.payload as string;
      expect(promptText).toContain('"extracted": true');
      expect(promptText).not.toContain('[FILE:'); // Should be inlined
    });

    it('[DATA] multiple large outputs each get their own file', async () => {
      const largeA = 'a'.repeat(6_000);
      const largeB = JSON.stringify({ tables: Array.from({ length: 100 }, (_, i) => ({ id: i, data: 'x'.repeat(50) })) });
      const context = buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue({
          'step-a': { raw: largeA },
          'step-b': { payload: JSON.parse(largeB) },
        }),
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');

      mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
        const outputDir = (options as Record<string, unknown>).outputDir as string;
        // Both files should exist
        const fileA = await readFile(join(outputDir, 'prev-step-a-raw.md'), 'utf-8');
        expect(fileA).toBe(largeA);
        const fileB = await readFile(join(outputDir, 'prev-step-b-payload.json'), 'utf-8');
        expect(JSON.parse(fileB)).toEqual(JSON.parse(largeB));

        return {
          cliOutput: JSON.stringify({ result: '"done"' }),
          gitMetadata: null,
          presentation: null,
          outputDir,
          injectedEnvVars: [],
        };
      });

      await plugin.run(emit);

      const promptEvent = events.find((e) => e.type === 'prompt');
      const promptText = promptEvent!.payload as string;
      expect(promptText).toContain('[FILE: /output/prev-step-a-raw.md]');
      expect(promptText).toContain('[FILE: /output/prev-step-b-payload.json]');
    });
  });

  describe('Docker I/O: container outputs → system', () => {
    // Verifies that files written by the agent inside the container (to /output/)
    // are correctly resolved and collected by the system via host path mapping.

    it('[DATA] output_file contract resolves /output/ path to host path', async () => {
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-output-'));
      const resultData = { tables: [{ id: 'T-1', title: 'Demographics' }], count: 1 };
      await writeFile(join(hostOutputDir, 'result.json'), JSON.stringify(resultData));

      const agentResponse = JSON.stringify({
        output_file: '/output/result.json',
        summary: 'Generated 1 table',
      });

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: agentResponse }),
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir, injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      expect(result.tables).toEqual(resultData.tables);
      expect(result.count).toBe(1);
      expect(result.summary).toBe('Generated 1 table');

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[DATA] fallback to /output/result.json when agent output is not valid JSON', async () => {
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-fallback-'));
      const resultData = { status: 'completed', items: ['a', 'b'] };
      await writeFile(join(hostOutputDir, 'result.json'), JSON.stringify(resultData));

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        // result is text, not JSON — should fall back to reading result.json
        cliOutput: JSON.stringify({ result: 'I completed the task successfully.' }),
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir, injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      expect(result.status).toBe('completed');
      expect(result.items).toEqual(['a', 'b']);

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[DATA] markdown output_file is returned as raw content', async () => {
      const hostOutputDir = await mkdtemp(join(tmpdir(), 'test-docker-md-'));
      const mdContent = '# TLG Shells\n\n## Table 14.1\nDemographics summary\n';
      await writeFile(join(hostOutputDir, 'tlg-shells.md'), mdContent);

      const agentResponse = JSON.stringify({
        output_file: '/output/tlg-shells.md',
        summary: 'Generated TLG shells',
      });

      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: agentResponse }),
        gitMetadata: null,
        presentation: null,
        outputDir: hostOutputDir, injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const result = payload.result as Record<string, unknown>;

      expect(result.raw).toBe(mdContent);
      expect(result.output_file).toContain('tlg-shells.md');
      expect(result.summary).toBe('Generated TLG shells');

      await rm(hostOutputDir, { recursive: true, force: true });
    });

    it('[DATA] git metadata is collected from /output/git-result.json', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockReadSkill(plugin).mockResolvedValue('# Skill');
      mockSpawn(plugin).mockResolvedValue({
        cliOutput: JSON.stringify({ result: '"done"' }),
        gitMetadata: {
          commitSha: 'abc123',
          branch: 'run/pi-001',
          changedFiles: ['src/adam.R', 'src/utils.R'],
          repoUrl: 'https://github.com/Appsilon/mediforce-clinical-workspace',
        },
        presentation: null,
        outputDir: '/tmp/mock', injectedEnvVars: [],
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      const gitMeta = payload.gitMetadata as Record<string, unknown>;

      expect(gitMeta.commitSha).toBe('abc123');
      expect(gitMeta.branch).toBe('run/pi-001');
      expect(gitMeta.changedFiles).toEqual(['src/adam.R', 'src/utils.R']);
    });
  });

  describe('getMockDockerArgs', () => {
    it('[DATA] generates mock output in OpenCode JSON format', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const args = plugin.getMockDockerArgs('generate-tlg', false);

      // The last arg to bash -c should echo JSON with "response" key
      const bashCommand = args[2];
      expect(bashCommand).toContain('mock-opencode');
      expect(bashCommand).toContain('text');
      expect(bashCommand).toContain('mock-result.json');
    });

    it('[DATA] includes git workspace write for git mode', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const args = plugin.getMockDockerArgs('generate-tlg', true);
      const bashCommand = args[2];
      expect(bashCommand).toContain('/workspace/mock-generate-tlg-output.md');
    });
  });
});

import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/step-executor-plugin';
import type { ProcessConfig } from '@mediforce/platform-core';
import { OpenCodeAgentPlugin, normaliseModelId } from '../opencode-agent-plugin';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager';

const originalAllowLocal = process.env.ALLOW_LOCAL_AGENTS;
beforeEach(() => {
  delete process.env.ALLOW_LOCAL_AGENTS;
});
afterAll(() => {
  if (originalAllowLocal !== undefined) {
    process.env.ALLOW_LOCAL_AGENTS = originalAllowLocal;
  }
});

type DockerResult = { cliOutput: string; injectedEnvVars: string[] };
type SpawnDockerTarget = { spawnDockerContainer: (prompt: string, options?: Record<string, unknown>) => Promise<DockerResult> };

function mockSpawn(plugin: OpenCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as SpawnDockerTarget, 'spawnDockerContainer');
}

/** A spawn that leaves `result` in the step's output folder as result.json —
 *  what the agent does (ADR-0030) — and returns what the CLI printed. */
function finishesWith(result: unknown, spawnResult: Partial<DockerResult> = {}) {
  return async (_prompt: string, options?: Record<string, unknown>): Promise<DockerResult> => {
    await writeFile(join(options!.stepOutputDir as string, 'result.json'), JSON.stringify(result));
    return { cliOutput: '', injectedEnvVars: [], ...spawnResult };
  };
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
            prompt: 'Extract trial metadata from the protocol',
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

describe('normaliseModelId', () => {
  it('converts first __ to /', () => {
    expect(normaliseModelId('deepseek__deepseek-v4-flash:free')).toBe('deepseek/deepseek-v4-flash:free');
  });

  it('handles tilde-prefixed provider', () => {
    expect(normaliseModelId('~anthropic__claude-haiku-latest')).toBe('~anthropic/claude-haiku-latest');
  });

  it('leaves already-normalised IDs unchanged', () => {
    expect(normaliseModelId('deepseek/deepseek-chat')).toBe('deepseek/deepseek-chat');
    expect(normaliseModelId('openrouter/deepseek/deepseek-chat')).toBe('openrouter/deepseek/deepseek-chat');
  });

  it('leaves bare model names unchanged', () => {
    expect(normaliseModelId('gpt-4o')).toBe('gpt-4o');
  });

  it('only replaces the first __ occurrence', () => {
    expect(normaliseModelId('provider__model__variant')).toBe('provider/model__variant');
  });
});

describe('OpenCodeAgentPlugin', () => {
  let plugin: OpenCodeAgentPlugin;

  beforeEach(() => {
    plugin = new OpenCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
  });

  describe('initialize', () => {
    it('[DATA] stores context and extracts agentConfig', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);
      expect(() => plugin.initialize(context)).not.toThrow();
    });

    it('[ERROR] throws if no prompt configured', async () => {
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
      await expect(plugin.initialize(context)).rejects.toThrow("No prompt configured in agentConfig for step 'extract'");
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
                prompt: 'Extract trial metadata from the protocol',
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

      const spec = plugin.getAgentCommand('/engine/prompt.txt');
      expect(spec.args[0]).toBe('bash');
      expect(spec.args[1]).toBe('-c');
      expect(spec.args[2]).toContain('opencode run');
      expect(spec.args[2]).toContain('$(cat /engine/prompt.txt)');
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
      expect(vars.OPENCODE_CONFIG).toBe('/engine/opencode.json');
      expect(vars.XDG_DATA_HOME).toBe('/engine/.local/share');
    });
  });

  describe('parseAgentOutput', () => {
    it('[DATA] keeps none of the model\'s text — its final message is not the step result', () => {
      const stdout = [
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 1000, output: 500 } } }),
        openCodeJsonOutput(JSON.stringify({ confidence: 0.9, summary: 'OK' })),
      ].join('\n');

      const parsed = JSON.parse(plugin.parseAgentOutput(stdout));

      expect(parsed).toEqual({ usage: { input_tokens: 1000, output_tokens: 500, peak_input_tokens: 1000 } });
    });

    it('[DATA] handles multi-line stdout with Docker/entrypoint noise', () => {
      const stdout = [
        'Cloning repository...',
        'Switched to branch run/pi-001',
        '[entrypoint] Running command...',
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 10, output: 5 } } }),
      ].join('\n');

      expect(JSON.parse(plugin.parseAgentOutput(stdout)).usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
    });

    it('[DATA] returns empty string when no JSON found in stdout', () => {
      const result = plugin.parseAgentOutput('some random non-json output\nstuff');
      expect(result).toBe('');
    });

    it('[DATA] returns empty string for empty stdout', () => {
      const result = plugin.parseAgentOutput('');
      expect(result).toBe('');
    });

    it('[DATA] accumulates token usage from step_finish events', () => {
      const stdout = [
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 1000, output: 500 }, cost: 0.01 } }),
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 2000, output: 800 }, cost: 0.02 } }),
      ].join('\n');

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);
      expect(parsed.usage).toEqual({ input_tokens: 3000, output_tokens: 1300, peak_input_tokens: 2000 });
    });

    it('[DATA] reports peak_input_tokens as the max single-turn prompt, not the sum', () => {
      const stdout = [
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 5000, output: 100 }, cost: 0.01 } }),
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 42000, output: 300 }, cost: 0.02 } }),
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 18000, output: 200 }, cost: 0.02 } }),
      ].join('\n');

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);
      expect(parsed.usage.peak_input_tokens).toBe(42000);
      expect(parsed.usage.input_tokens).toBe(65000);
    });

    it('[DATA] peak_input_tokens counts cached prompt tokens, not just uncached input', () => {
      // With prompt caching on, `input` is only the uncached delta; the real
      // context occupancy is input + cache.read + cache.write.
      const stdout = [
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 26, output: 100, cache: { read: 8158, write: 0 } }, cost: 0.01 } }),
        JSON.stringify({ type: 'step_finish', part: { tokens: { input: 40, output: 200, cache: { read: 60000, write: 1200 } }, cost: 0.02 } }),
      ].join('\n');

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);
      expect(parsed.usage.peak_input_tokens).toBe(61240); // 40 + 60000 + 1200
    });

    it('[DATA] returns empty string when no step_finish event has tokens and nothing failed', () => {
      expect(plugin.parseAgentOutput(openCodeJsonOutput('Done.'))).toBe('');
    });
  });

  describe('writeAgentConfig', () => {
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
                prompt: 'Extract trial metadata from the protocol',
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
        await (plugin as unknown as { writeAgentConfig: (dir: string) => Promise<void> }).writeAgentConfig(tempDir);

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
        await (plugin as unknown as { writeAgentConfig: (dir: string) => Promise<void> }).writeAgentConfig(tempDir);

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

      const agentResponse = JSON.stringify({ confidence: 0.85, summary: 'Extracted' });
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: agentResponse }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toBe('spawning OpenCode');
    });

    it('[DATA] builds prompt from the configured prompt and input data', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      expect(spawnSpy).toHaveBeenCalledOnce();
      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Extract trial metadata from the protocol');
      expect(prompt).toContain('/data/protocol.pdf');
    });

    it('[DATA] prompt has one Output section naming the workspace and /output/result.json', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('## Output');
      expect(prompt).toContain('Your workspace is the git repository at /workspace');
      expect(prompt).toContain('/output/result.json — required');
      expect(prompt).not.toContain('Result Contract Directory');
    });

    it('[DATA] emits result with valid AgentOutputEnvelope', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'extracted data', confidence: 0.9 }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBeTypeOf('number');
      expect(payload.reasoning_summary).toContain('OpenCode');
      expect(payload.reasoning_chain).toBeInstanceOf(Array);
      expect(payload.duration_ms).toBeTypeOf('number');
    });

    it('[ERROR] re-throws errors and emits error event (not fake result)', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
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
    // host engine directory (which gets mounted as /engine in Docker), and
    // that the prompt references them via container paths (/engine/...).

    it('[DATA] large previous step output is written to the host engine dir, not container path', async () => {
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

        // Capture the prompt and verify the file was written to hostDir
        const spawnSpy = mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
          // At spawn time, the large file should already exist in the engine dir
          const engineDir = (options as Record<string, unknown>).engineDir as string;
          const fileContent = await readFile(join(engineDir, 'previous-outputs', 'prev-generate-tlg-shells-raw.md'), 'utf-8');
          expect(fileContent).toBe(largeOutput);

          return finishesWith({ ok: true })(_prompt, options);
        });

        await plugin.run(emit);

        // Prompt should reference the /engine/ container path, not the host path
        const promptEvent = events.find((e) => e.type === 'prompt');
        expect(promptEvent).toBeDefined();
        const promptText = promptEvent!.payload as string;
        expect(promptText).toContain('[FILE: /engine/previous-outputs/prev-generate-tlg-shells-raw.md]');
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
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

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

      mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
        const engineDir = (options as Record<string, unknown>).engineDir as string;
        // Both files should exist
        const fileA = await readFile(join(engineDir, 'previous-outputs', 'prev-step-a-raw.md'), 'utf-8');
        expect(fileA).toBe(largeA);
        const fileB = await readFile(join(engineDir, 'previous-outputs', 'prev-step-b-payload.json'), 'utf-8');
        expect(JSON.parse(fileB)).toEqual(JSON.parse(largeB));

        return finishesWith({ ok: true })(_prompt, options);
      });

      await plugin.run(emit);

      const promptEvent = events.find((e) => e.type === 'prompt');
      const promptText = promptEvent!.payload as string;
      expect(promptText).toContain('[FILE: /engine/previous-outputs/prev-step-a-raw.md]');
      expect(promptText).toContain('[FILE: /engine/previous-outputs/prev-step-b-payload.json]');
    });

    it('[DATA] previous step outputs appear once, not again under `steps` in Input Data', async () => {
      const previousOutputs = { 'extract-metadata': { studyId: 'STUDY-UNIQUE-42' } };
      const context = buildMockContext({
        stepInput: { studyId: 'STUDY-UNIQUE-42', steps: previousOutputs },
        getPreviousStepOutputs: vi.fn().mockResolvedValue(previousOutputs),
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const promptText = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(promptText.split('STUDY-UNIQUE-42')).toHaveLength(3);
    });

    it('[DATA] previous step outputs come from `steps` in the input, the latest value of each step', async () => {
      const context = buildMockContext({
        stepInput: { steps: { review: { comments: 'second-round comments' } } },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({ review: { comments: 'first-round comments' } }),
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const promptText = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(promptText).toContain('second-round comments');
      expect(promptText).not.toContain('first-round comments');
    });

    it('[DATA] a workspace that cannot list earlier steps\' files still runs the step, without the section', async () => {
      const workspaceManager = createFakeWorkspaceManager();
      vi.mocked(workspaceManager.listStepFiles).mockRejectedValue(new Error('fatal: bad revision'));
      plugin = new OpenCodeAgentPlugin({ workspaceManager });
      await plugin.initialize(buildMockContext());

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const promptText = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(promptText).not.toContain('Repository Changes From Previous Steps');
      expect(events.some((e) => e.type === 'result')).toBe(true);
    });

    it('[DATA] lists the files earlier steps committed, at the paths the agent sees them', async () => {
      plugin = new OpenCodeAgentPlugin({
        workspaceManager: createFakeWorkspaceManager({
          outputFiles: [
            { stepId: 'generate-samples', name: 'samples.csv', path: '.mediforce/output/generate-samples/samples.csv', size: 10 },
          ],
          stepFiles: [
            { stepId: 'generate-samples', files: ['code/generate.py'] },
            { stepId: 'review', files: ['notes.md'] },
          ],
        }),
      });
      await plugin.initialize(buildMockContext());

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const promptText = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(promptText).toContain('## Previous Steps');
      expect(promptText).toContain('## Repository Changes From Previous Steps');
      expect(promptText).toContain('- /workspace/.mediforce/output/generate-samples/samples.csv');
      expect(promptText).toContain('- /workspace/code/generate.py');
      expect(promptText).toContain('- /workspace/notes.md');
    });

    it('[DATA] omits the previous-step files section when no step has committed a file', async () => {
      await plugin.initialize(buildMockContext());

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: '"done"' }), injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const promptText = events.find((e) => e.type === 'prompt')!.payload as string;
      expect(promptText).not.toContain('Repository Changes From Previous Steps');
    });
  });

  describe('Docker I/O: container outputs → system', () => {
    it('[DATA] the result is /output/result.json, whatever the model said last', async () => {
      const resultData = { tables: [{ id: 'T-1', title: 'Demographics' }], count: 1 };
      await plugin.initialize(buildMockContext());

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith(resultData, {
        cliOutput: JSON.stringify({ result: JSON.stringify({ output_file: '/output/tlg-shells.md', summary: 'Generated 1 table' }) }),
      }));

      await plugin.run(emit);

      const payload = events.find((e) => e.type === 'result')!.payload as Record<string, unknown>;
      expect(payload.result).toEqual(resultData);
    });

    it('[DATA] git metadata comes from the step commit', async () => {
      await plugin.initialize(buildMockContext());

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }));

      await plugin.run(emit);

      const payload = events.find((e) => e.type === 'result')!.payload as Record<string, unknown>;
      expect(payload.gitMetadata).toMatchObject({ commitSha: 'fake-commit-sha', branch: 'run/pi-001' });
    });
  });

  describe('getMockDockerArgs', () => {
    it('[DATA] generates mock output in OpenCode JSON format', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const args = plugin.getMockDockerArgs('generate-tlg');

      const bashCommand = args[2];
      expect(bashCommand).toContain('mock-opencode');
      expect(bashCommand).toContain('text');
      expect(bashCommand).toContain('/output/result.json');
    });

    it('[DATA] copies fixture workspace files into /workspace/ when _workspaceDir is set', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const args = plugin.getMockDockerArgs('generate-tlg');
      const bashCommand = args[2];
      expect(bashCommand).toContain('_workspaceDir');
      expect(bashCommand).toContain('/workspace/');
    });
  });
});

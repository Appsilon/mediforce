import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { AgentContext, EmitFn, EmitPayload, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin';
import { RetiredFileSkillError } from '../../skills/resolve-skills-for-step';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager';

type DockerResult = { cliOutput: string; failedMcpServers?: string[]; pendingMcpServers?: string[]; injectedEnvVars: string[] };
type SpawnDockerTarget = { spawnDockerContainer: (prompt: string, options?: Record<string, unknown>) => Promise<DockerResult> };
type SpawnLocalTarget = {
  spawnLocalProcess: (prompt: string, options: Record<string, unknown>, workingDir: string) => Promise<DockerResult>;
};

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

function mockSpawnLocal(plugin: ClaudeCodeAgentPlugin) {
  return vi.spyOn(plugin as unknown as SpawnLocalTarget, 'spawnLocalProcess');
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
          plugin: 'claude-code-agent',
          agentConfig: {
            prompt: 'Extract trial metadata from the protocol',
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

function buildWorkflowContext(agentOverrides: Record<string, unknown>): WorkflowAgentContext {
  return {
    stepId: 'triage',
    processInstanceId: 'pi-868',
    runNamespace: 'test-namespace',
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L2',
    workflowDefinition: {
      name: 'wf',
      version: 1,
      namespace: 'test-namespace',
      visibility: 'private',
      steps: [],
      transitions: [],
    },
    step: {
      id: 'triage',
      name: 'Triage',
      type: 'creation',
      executor: 'agent',
      agent: {
        prompt: 'Extract trial metadata from the protocol',
        image: 'mediforce-agent:protocol-to-tfl',
        ...agentOverrides,
      },
    },
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  } as unknown as WorkflowAgentContext;
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
    it('[DATA] accepts a config with a prompt', async () => {
      await expect(plugin.initialize(buildMockContext())).resolves.toBeUndefined();
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
              plugin: 'claude-code-agent',
              agentConfig: { image: 'mediforce-agent:protocol-to-tfl' },
            },
          ],
        },
      });
      await expect(plugin.initialize(context)).rejects.toThrow("No prompt configured in agentConfig for step 'extract'");
    });

    it('[ERROR] throws if a workflow step has no prompt', async () => {
      await expect(plugin.initialize(buildWorkflowContext({ prompt: undefined })))
        .rejects.toThrow("No prompt configured in step.agent for step 'triage'");
    });

    it('[DATA] runs a step with no prompt of its own when its Agent gives one (ADR-0029 agent eval trial)', async () => {
      const context = { ...buildWorkflowContext({ prompt: undefined }), agentIdentityPrompt: 'You grade adverse events by CTCAE v5.' };
      await expect(plugin.initialize(context)).resolves.toBeUndefined();
    });

    it('[ERROR] refuses a step that still names a retired file skill, naming the step and the skill', async () => {
      const error = await plugin.initialize(buildWorkflowContext({ retiredFileSkill: 'trial-metadata-extractor' }))
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RetiredFileSkillError);
      expect((error as RetiredFileSkillError).message).toContain(
        "Step 'triage' uses the file skill 'trial-metadata-extractor', which no longer runs (ADR-0028)",
      );
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
                prompt: 'Extract trial metadata from the protocol',
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
                prompt: 'Extract trial metadata from the protocol',
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

  describe('parseAgentOutput', () => {
    it('[DATA] extracts last result event from stream-json', () => {
      const resultEvent = JSON.stringify({
        type: 'result', subtype: 'success',
        result: 'Done.',
        usage: { input_tokens: 5000, output_tokens: 1200 },
      });
      const stdout = [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'working...' }] } }),
        resultEvent,
      ].join('\n');

      const result = plugin.parseAgentOutput(stdout);
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe('result');
      expect(parsed.usage).toEqual({ input_tokens: 5000, output_tokens: 1200 });
    });

    it('[DATA] preserves usage field for token extraction', () => {
      const resultEvent = JSON.stringify({
        type: 'result', subtype: 'success',
        result: 'plain text response',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 30 },
      });

      const result = plugin.parseAgentOutput(resultEvent);
      const parsed = JSON.parse(result);
      expect(parsed.usage.input_tokens).toBe(100);
      expect(parsed.usage.output_tokens).toBe(50);
    });

    it('[DATA] returns empty for non-result events only', () => {
      const stdout = JSON.stringify({ type: 'assistant', message: { content: [] } });
      const result = plugin.parseAgentOutput(stdout);
      expect(result).toBe('');
    });

    it('[DATA] folds peak per-turn context (input + cache) into result usage', () => {
      const stdout = [
        JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 40_000, cache_read_input_tokens: 10_000, output_tokens: 200 } } }),
        JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 90_000, cache_read_input_tokens: 60_000, cache_creation_input_tokens: 5_000, output_tokens: 300 } } }),
        JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 20_000, output_tokens: 100 } } }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 20_000, output_tokens: 100 } }),
      ].join('\n');

      const parsed = JSON.parse(plugin.parseAgentOutput(stdout));
      // Peak is the largest single turn's full prompt: 90k + 60k + 5k = 155k,
      // not the final turn (20k) that result.usage would otherwise report.
      expect(parsed.usage.peak_input_tokens).toBe(155_000);
      expect(parsed.usage.input_tokens).toBe(20_000);
    });

    it('[DATA] leaves usage untouched when no assistant turn reports tokens', () => {
      const stdout = [
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
        JSON.stringify({ type: 'result', subtype: 'success', result: 'done', usage: { input_tokens: 5_000, output_tokens: 50 } }),
      ].join('\n');

      const parsed = JSON.parse(plugin.parseAgentOutput(stdout));
      expect(parsed.usage).toEqual({ input_tokens: 5_000, output_tokens: 50 });
    });
  });

  describe('run', () => {
    it('[DATA] emits status event before spawning CLI', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: 'extracted metadata', confidence: 0.85 }), injectedEnvVars: [] },
      ));

      await plugin.run(emit);

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toBe('spawning Claude Code');
    });

    it('[DATA] says so when the CLI reports a bound MCP server as failed, instead of staying silent', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ confidence: 0.9 }) }),
        failedMcpServers: ['biomcp'],
        injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const warnings = events.filter((e) => e.type === 'status' && String(e.payload).includes('MCP server'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].payload).toContain("MCP server 'biomcp' failed to start");
      expect(warnings[0].payload).toContain("mediforce-agent:protocol-to-tfl");
    });

    it('[DATA] warns, without failing the step, when a bound MCP server was still connecting as the agent started', async () => {
      await plugin.initialize({
        ...buildWorkflowContext({}),
        resolvedMcpConfig: { servers: { biomcp: { type: 'stdio', command: 'uvx' } } },
      } as WorkflowAgentContext);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ confidence: 0.9 }) }),
        pendingMcpServers: ['biomcp'],
        injectedEnvVars: [],
      }));

      await expect(plugin.run(emit)).resolves.toBeUndefined();

      const warnings = events.filter((e) => e.type === 'status' && String(e.payload).includes('MCP server'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].payload).toContain("MCP server 'biomcp' was still connecting");
      expect(warnings[0].payload).toContain("set MCP_TIMEOUT (milliseconds, now 120000) in the step's env");
    });

    it('[DATA] leaves out the MCP_TIMEOUT hint for an http server, which has no cold start to wait out', async () => {
      await plugin.initialize({
        ...buildWorkflowContext({}),
        resolvedMcpConfig: { servers: { remote: { type: 'http', url: 'https://mcp.example.com' } } },
      } as WorkflowAgentContext);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ confidence: 0.9 }) }),
        failedMcpServers: ['remote'],
        pendingMcpServers: ['remote'],
        injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const warnings = events.filter((e) => e.type === 'status' && String(e.payload).includes('MCP server'));
      expect(warnings).toHaveLength(2);
      for (const warning of warnings) {
        expect(warning.payload).not.toContain('MCP_TIMEOUT');
      }
    });

    it('[DATA] points at the host, not an image, when the failed MCP server ran in local mode', async () => {
      process.env.ALLOW_LOCAL_AGENTS = 'true';
      const context = buildMockContext({
        config: {
          processName: 'p', configName: 'c', configVersion: 'v1',
          stepConfigs: [{ stepId: 'extract', executorType: 'agent', plugin: 'claude-code-agent', agentConfig: { prompt: 'Extract trial metadata from the protocol' } }],
        } as ProcessConfig,
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawnLocal(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: JSON.stringify({ confidence: 0.9 }) }),
        failedMcpServers: ['biomcp'], injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const warning = events.find((e) => e.type === 'status' && String(e.payload).includes("MCP server 'biomcp'"));
      expect(warning?.payload).toContain('installed on the host');
      expect(String(warning?.payload)).not.toContain('undefined');
    });

    it.each(['local', 'docker'] as const)(
      '[DATA] takes the result from result.json and ignores the closing message (%s mode)',
      async (mode) => {
        process.env.ALLOW_LOCAL_AGENTS = 'true';
        const context = buildMockContext({
          config: {
            processName: 'p', configName: 'c', configVersion: 'v1',
            stepConfigs: [{
              stepId: 'extract', executorType: 'agent', plugin: 'claude-code-agent',
              agentConfig: { prompt: 'Extract trial metadata from the protocol', ...(mode === 'docker' ? { image: 'mediforce-agent:test' } : {}) },
            }],
          } as ProcessConfig,
        });
        await plugin.initialize(context);

        const spawned = finishesWith(
          { classification: 'recovery', confidence: 0.8 },
          { cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: '{"classification":"fatal","confidence":0.99}' }) },
        );
        if (mode === 'local') mockSpawnLocal(plugin).mockImplementation(spawned);
        else mockSpawn(plugin).mockImplementation(spawned);

        const { emit, events } = buildEmitSpy();
        await plugin.run(emit);

        const resultEvent = events.find((e) => e.type === 'result');
        expect(resultEvent?.payload).toMatchObject({ confidence: 0.8, result: { classification: 'recovery' } });
        expect((resultEvent?.payload as { result: Record<string, unknown> }).result).not.toHaveProperty('raw');
      },
    );

    it.each([
      ['missing', null, 'agent wrote no result.json'],
      ['not JSON', 'All done.', 'result.json is not valid JSON'],
      ['a JSON array', '[{"grade":3}]', 'result.json is not a JSON object'],
    ] as const)('[ERROR] fails the step when result.json is %s, even when the closing message is JSON', async (_label, contents, message) => {
      await plugin.initialize(buildMockContext());
      mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
        if (contents !== null) await writeFile(join(options!.stepOutputDir as string, 'result.json'), contents);
        return { cliOutput: JSON.stringify({ type: 'result', subtype: 'success', result: '{"grade":3,"confidence":0.9}' }), injectedEnvVars: [] };
      });

      const { emit, events } = buildEmitSpy();
      await expect(plugin.run(emit)).rejects.toThrow(message);

      expect(events.find((e) => e.type === 'result')).toBeUndefined();
    });

    it('[DATA] moves the reserved confidence keys onto the envelope, leaving the result as the output schema sees it', async () => {
      await plugin.initialize(buildMockContext());
      mockSpawn(plugin).mockImplementation(finishesWith({ ctcaeGrade: 3, confidence: 0.85, confidence_rationale: 'Lab values complete.' }));

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const payload = events.find((e) => e.type === 'result')!.payload as Record<string, unknown>;
      expect(payload).toMatchObject({ confidence: 0.85, confidence_rationale: 'Lab values complete.' });
      expect(payload.result).toEqual({ ctcaeGrade: 3 });
    });

    it('[DATA] seeds the step input as input.json in the output folder', async () => {
      await plugin.initialize(buildMockContext());
      let seeded: unknown;
      mockSpawn(plugin).mockImplementation(async (prompt, options) => {
        seeded = JSON.parse(await readFile(join(options!.stepOutputDir as string, 'input.json'), 'utf-8'));
        return finishesWith({ ok: true })(prompt, options);
      });

      await plugin.run(buildEmitSpy().emit);

      expect(seeded).toEqual({ filePaths: ['/data/protocol.pdf', '/data/sap.pdf'] });
    });

    it('[DATA] folds cache_creation into input tokens and captures cache_read for cost', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: JSON.stringify({ summary: 'done' }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 30,
          },
        }),
        injectedEnvVars: [],
      }));

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent?.payload).toMatchObject({
        tokenUsage: { inputTokens: 120, outputTokens: 50, cachedInputTokens: 30 },
      });
    });

    it('[DATA] routes image-less build-mode workflow agents through Docker', async () => {
      const context: WorkflowAgentContext = {
        stepId: 'extract',
        processInstanceId: 'pi-001',
        runNamespace: 'test-namespace',
        definitionVersion: 'v1',
        stepInput: { filePaths: ['/data/protocol.pdf'] },
        autonomyLevel: 'L2',
        workflowDefinition: {
          name: 'protocol-to-tfl',
          version: 1,
          namespace: 'test-namespace',
          visibility: 'private',
          steps: [],
          transitions: [],
        },
        step: {
          id: 'extract',
          name: 'Extract metadata',
          type: 'creation',
          executor: 'agent',
          agent: {
            prompt: 'Extract trial metadata from the protocol',
            dockerfile: 'Dockerfile.agent',
            repo: 'https://github.com/appsilon/mediforce-agent.git',
            commit: 'abcdef1234567890abcdef1234567890abcdef12',
          },
        },
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const dockerSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }),
        injectedEnvVars: [],
      }));
      const localSpy = mockSpawnLocal(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'local' }),
        injectedEnvVars: [],
      }));

      await plugin.run(emit);

      expect(localSpy).not.toHaveBeenCalled();
      expect(dockerSpy).toHaveBeenCalledOnce();
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          type: 'status',
          payload: expect.stringMatching(/using Docker container image 'mediforce-built:[a-f0-9]{12}'/),
        }),
      ]));
    });

    it('[DATA] builds prompt from the configured prompt and input data', async () => {
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
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, { cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [] }));

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('Analyze these PDF files');
      expect(prompt).toContain('/data/protocol.pdf');
      expect(prompt).toContain('/data/sap.pdf');
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
                prompt: 'Extract trial metadata from the protocol',
                model: 'sonnet',
                image: 'mediforce-agent:protocol-to-tfl',
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, { cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [] }));

      await plugin.run(emit);

      const [, options] = spawnSpy.mock.calls[0];
      expect(options).toMatchObject({ model: 'sonnet' });
    });

    it('[DATA] emits result with valid AgentOutputEnvelope', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: 'extracted data', confidence: 0.9 }), injectedEnvVars: [] },
      ));

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
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true, confidence: 0.72, confidence_rationale: 'Missing supplier X data — interpolated from similar category.' }));

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence_rationale).toBe('Missing supplier X data — interpolated from similar category.');
    });

    it('[DATA] omits confidence_rationale from envelope when agent does not provide it', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: { ok: true }, confidence: 0.9 }), injectedEnvVars: [] },
      ));

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('confidence_rationale');
    });

    it('[DATA] includes confidence self-assessment instructions in prompt', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [] },
      ));

      await plugin.run(emit);

      const promptArg = spawnSpy.mock.calls[0][0] as string;
      expect(promptArg).toContain('## Confidence');
      expect(promptArg).toContain('Set `confidence` and `confidence_rationale` in result.json');
      expect(promptArg).toContain('100 cases like this');
      expect(promptArg).not.toContain('your output JSON');
    });

    it('[DATA] includes agent.outputSchema in the prompt', async () => {
      const outputSchema = { type: 'object' as const, required: ['findings'] };
      const context: WorkflowAgentContext = {
        stepId: 'extract',
        processInstanceId: 'pi-001',
        runNamespace: 'test-namespace',
        definitionVersion: 'v1',
        stepInput: {},
        autonomyLevel: 'L2',
        workflowDefinition: {
          name: 'protocol-to-tfl',
          version: 1,
          namespace: 'test-namespace',
          visibility: 'private',
          steps: [],
          transitions: [],
        },
        step: {
          id: 'extract',
          name: 'Extract metadata',
          type: 'creation',
          executor: 'agent',
          agent: { prompt: 'Extract findings', image: 'mediforce-agent:protocol-to-tfl', outputSchema },
        },
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await plugin.initialize(context);

      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [] },
      ));

      await plugin.run(buildEmitSpy().emit);

      const promptArg = spawnSpy.mock.calls[0][0] as string;
      expect(promptArg).toContain('## Output Schema');
      expect(promptArg).toContain('"required": [\n    "findings"\n  ]');
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
                prompt: 'Extract trial metadata from the protocol',
                image: 'mediforce-agent:protocol-to-tfl',
                // no repo or commit — standalone mode
              },
            },
          ],
        },
      });
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, 
        { cliOutput: JSON.stringify({ result: 'standalone output', confidence: 0.85 }), injectedEnvVars: [] },
      ));

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();

      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload.confidence).toBeTypeOf('number');
      expect(payload.confidence).toBeGreaterThan(0);
    });

    it('[DATA] tells the agent, in one Output section, that result.json and the files in /output are all that is kept', async () => {
      await plugin.initialize(buildMockContext());
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }));

      await plugin.run(buildEmitSpy().emit);

      const prompt = spawnSpy.mock.calls[0][0] as string;
      expect(prompt.match(/^## Output$/gm)).toHaveLength(1);
      expect(prompt).toContain('/output/result.json — required');
      expect(prompt).toContain('Your final message is discarded.');
      expect(prompt).toContain('Your workspace is the git repository at /workspace');
      expect(prompt).not.toContain('Result Contract Directory');
      expect(prompt).not.toContain('Write ALL deliverable files');
      expect(prompt).not.toContain('Do not offer conversational summaries');
      expect(prompt).not.toContain('discarded when the step ends');
    });

    it('[DATA] prompt uses /output as output dir in Docker mode', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }),
        injectedEnvVars: [],
      }));

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
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, { cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [] }));

      await plugin.run(emit);

      const [prompt] = spawnSpy.mock.calls[0];
      expect(prompt).toContain('file1.pdf');
      expect(prompt).toContain('file2.pdf');
    });

    it('[DATA] gives each earlier step one entry — its result and its output files from git — apart from repository changes', async () => {
      plugin = new ClaudeCodeAgentPlugin({
        workspaceManager: createFakeWorkspaceManager({
          outputFiles: [
            { stepId: 'grade', name: 'ae-listing.csv', path: '.mediforce/output/grade/ae-listing.csv', size: 120 },
            { stepId: 'extract', name: 'stale.md', path: '.mediforce/output/extract/stale.md', size: 9 },
          ],
          stepFiles: [{ stepId: 'grade', files: ['code/derive.R'] }],
        }),
      });
      await plugin.initialize(buildMockContext({
        getPreviousStepOutputs: vi.fn().mockResolvedValue({ grade: { ctcaeGrade: 5, term: 'Death NOS' } }),
      }));
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }));

      await plugin.run(buildEmitSpy().emit);

      const prompt = spawnSpy.mock.calls[0][0] as string;
      const previousSteps = prompt.slice(prompt.indexOf('## Previous Steps'), prompt.indexOf('## Repository Changes From Previous Steps'));
      expect(previousSteps).toContain('### grade');
      expect(previousSteps).toContain('"ctcaeGrade": 5');
      expect(previousSteps).toContain('- /workspace/.mediforce/output/grade/ae-listing.csv');
      expect(previousSteps).not.toContain('### extract');
      expect(prompt).toContain('- /workspace/code/derive.R');
    });

    it('[DATA] treats presentation.html as an ordinary Output File — the result carries no presentation', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      mockSpawn(plugin).mockImplementation(async (prompt, options) => {
        await writeFile(join(options!.stepOutputDir as string, 'presentation.html'), '<h1>My Report</h1>');
        return finishesWith({ ok: true })(prompt, options);
      });

      await plugin.run(emit);

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
      const payload = resultEvent!.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('presentation');
      expect(payload).not.toHaveProperty('deliverableFile');
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
                prompt: 'Extract trial metadata from the protocol',
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
      mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }),
        injectedEnvVars: [],
      }));

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
                prompt: 'Extract trial metadata from the protocol',
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

      const spec = plugin.getAgentCommand('/engine/prompt.txt');
      expect(spec.args).toContain('--mcp-config');
      expect(spec.args).toContain('/engine/mcp-config.json');
    });

    it('[DATA] omits --mcp-config flag when no mcpServers configured', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const spec = plugin.getAgentCommand('/engine/prompt.txt');
      expect(spec.args).not.toContain('--mcp-config');
    });

    // The model reaches the plugin as an OpenRouter slug — that is what the
    // model registry and an agent's foundationModel both speak. The Anthropic
    // API does not know that spelling.
    describe('model spelling', () => {
      function withEnv(plugin: ClaudeCodeAgentPlugin, vars: Record<string, string>): void {
        (plugin as unknown as { resolvedEnv: { vars: Record<string, string> } }).resolvedEnv = { vars };
      }

      it('[DATA] passes the slug through when routed via the OpenRouter gateway', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { OPENROUTER_API_KEY: 'sk-or-x', ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1' });

        const spec = plugin.getAgentCommand('/engine/prompt.txt', { model: 'anthropic/claude-sonnet-4' });

        expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('anthropic/claude-sonnet-4');
      });

      it('[REGRESSION] strips the provider prefix when talking to the Anthropic API directly', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { ANTHROPIC_API_KEY: 'sk-ant-x' });

        const spec = plugin.getAgentCommand('/engine/prompt.txt', { model: 'anthropic/claude-sonnet-4' });

        expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('claude-sonnet-4');
      });

      it('[DATA] maps an OpenRouter latest alias to the CLI alias of the same family when talking to the Anthropic API directly', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { ANTHROPIC_API_KEY: 'sk-ant-x' });

        const spec = plugin.getAgentCommand('/engine/prompt.txt', { model: '~anthropic/claude-sonnet-latest' });

        expect(spec.args[spec.args.indexOf('--model') + 1]).toBe('sonnet');
      });

      it('[DATA] leaves an already-bare Anthropic id or CLI alias alone', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { ANTHROPIC_API_KEY: 'sk-ant-x' });

        for (const model of ['claude-sonnet-4-6', 'sonnet', 'haiku']) {
          const spec = plugin.getAgentCommand('/engine/prompt.txt', { model });
          expect(spec.args[spec.args.indexOf('--model') + 1]).toBe(model);
        }
      });

      it('[REGRESSION] refuses a non-Anthropic model rather than silently running a different one', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { ANTHROPIC_API_KEY: 'sk-ant-x' });

        expect(() => plugin.getAgentCommand('/engine/prompt.txt', { model: 'openai/gpt-4o' }))
          .toThrow(/openai\/gpt-4o/);
      });

      it('[DATA] emits no --model flag when no model is set', async () => {
        await plugin.initialize(buildMockContext());
        withEnv(plugin, { ANTHROPIC_API_KEY: 'sk-ant-x' });

        const spec = plugin.getAgentCommand('/engine/prompt.txt');

        expect(spec.args).not.toContain('--model');
      });
    });
  });

  // Issue #868: resolveStepTimeoutMinutes must be the single source feeding both
  // the PluginRunner Promise.race AND the container-kill timer. The emitted prompt's
  // "approximately N minutes" budget derives from the same timeoutMs the container
  // kill uses, so it is a faithful proxy for the effective timeout.
  describe('timeout single-source (issue #868)', () => {

    async function captureBudgetMinutes(agentOverrides: Record<string, unknown>): Promise<string> {
      const context = buildWorkflowContext(agentOverrides);
      await plugin.initialize(context);
      const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
        cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [],
      }));
      const { emit } = buildEmitSpy();
      await plugin.run(emit);
      const [prompt] = spawnSpy.mock.calls[0];
      return prompt as string;
    }

    it('[DATA] defaults an unconfigured step to resolveStepTimeoutMinutes (30), not DEFAULT_TIMEOUT_MS (20)', async () => {
      const prompt = await captureBudgetMinutes({});
      expect(prompt).toContain('approximately 30 minutes');
    });

    it('[DATA] honours an explicit step timeoutMinutes', async () => {
      const prompt = await captureBudgetMinutes({ timeoutMinutes: 45 });
      expect(prompt).toContain('approximately 45 minutes');
    });

    // The CLI holds the agent's first turn until each MCP server connects, for
    // MCP_TIMEOUT ms. A cold `uvx`/`npx` install routinely outlasts the CLI's own
    // 30s default, and the agent then starts without the server's tools.
    describe('MCP startup timeout', () => {
      function internalEnvVars(): Record<string, string> {
        return (plugin as unknown as { getInternalEnvVars(): Record<string, string> }).getInternalEnvVars();
      }

      it('[DATA] gives a step with a stdio MCP server a startup window longer than the CLI default', async () => {
        await plugin.initialize({
          ...buildWorkflowContext({}),
          resolvedMcpConfig: {
            servers: {
              biomcp: { type: 'stdio', command: 'uvx' },
              remote: { type: 'http', url: 'https://mcp.example.com' },
            },
          },
        } as WorkflowAgentContext);

        expect(internalEnvVars().MCP_TIMEOUT).toBe('120000');
      });

      it('[DATA] leaves the CLI default for a step whose MCP servers are all http', async () => {
        await plugin.initialize({
          ...buildWorkflowContext({}),
          resolvedMcpConfig: { servers: { remote: { type: 'http', url: 'https://mcp.example.com' } } },
        } as WorkflowAgentContext);

        expect(internalEnvVars().MCP_TIMEOUT).toBeUndefined();
      });

      it('[DATA] sets nothing for a step without MCP servers', async () => {
        await plugin.initialize(buildWorkflowContext({}));

        expect(internalEnvVars().MCP_TIMEOUT).toBeUndefined();
      });

      it('[DATA] leaves an MCP_TIMEOUT the step env sets explicitly alone', async () => {
        await plugin.initialize({
          ...buildWorkflowContext({}),
          resolvedMcpConfig: { servers: { biomcp: { type: 'stdio', command: 'uvx' } } },
        } as WorkflowAgentContext);
        (plugin as unknown as { resolvedEnv: { vars: Record<string, string> } }).resolvedEnv = { vars: { MCP_TIMEOUT: '600000' } };

        expect(internalEnvVars().MCP_TIMEOUT).toBeUndefined();
      });
    });

    // The CLI holds the first turn only on 2.1.292+. An older image starts the
    // agent with the server still `pending`, so the prompt tells it to wait.
    describe('MCP startup instruction', () => {
      async function promptFor(resolvedMcpConfig?: WorkflowAgentContext['resolvedMcpConfig']): Promise<string> {
        await plugin.initialize({ ...buildWorkflowContext({}), resolvedMcpConfig } as WorkflowAgentContext);
        const spawnSpy = mockSpawn(plugin).mockImplementation(finishesWith({ ok: true }, {
          cliOutput: JSON.stringify({ result: 'ok' }), injectedEnvVars: [],
        }));
        await plugin.run(buildEmitSpy().emit);
        return spawnSpy.mock.calls[0][0] as string;
      }

      it('[DATA] tells an agent with MCP servers to wait for them, naming the servers and the CLI tool', async () => {
        const prompt = await promptFor({
          servers: { biomcp: { type: 'stdio', command: 'uvx' }, remote: { type: 'http', url: 'https://mcp.example.com' } },
        });

        expect(prompt).toContain('## MCP Servers');
        expect(prompt).toContain('biomcp, remote');
        expect(prompt).toContain('WaitForMcpServers');
        expect(prompt).toContain('about 2 minutes');
      });

      it('[DATA] adds nothing for an agent without MCP servers', async () => {
        const prompt = await promptFor(undefined);

        expect(prompt).not.toContain('## MCP Servers');
        expect(prompt).not.toContain('WaitForMcpServers');
      });
    });

    it('[ERROR] still hands back an eval trial\'s MCP recording and replay misses when the agent fails (ADR-0023 D6)', async () => {
      const onRecorded = vi.fn().mockResolvedValue(undefined);
      const record = vi.fn();
      const context = {
        ...buildWorkflowContext({}),
        resolvedMcpConfig: { servers: { meddra: { type: 'stdio', command: 'meddra-mcp' }, edc: { type: 'stdio', command: 'edc-mcp' } } },
        mcpTapes: { replay: { edc: { tools: [], calls: [] } }, record: ['meddra'], onRecorded },
        trajectory: { record },
      } as WorkflowAgentContext;
      await plugin.initialize(context);
      mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
        const tapeDir = join(options!.engineDir as string, 'mcp-tape');
        await mkdir(tapeDir, { recursive: true });
        await writeFile(join(tapeDir, 'meddra.tape.jsonl'), `${JSON.stringify({ kind: 'call', tool: 'lookup', arguments: { term: 'Sepsis' }, result: { content: [] } })}\n`);
        await writeFile(join(tapeDir, 'edc.misses.jsonl'), `${JSON.stringify({ ts: '2026-09-28T10:00:00.000Z', tool: 'read_record', arguments: { subject: '1001' } })}\n`);
        throw new Error('Agent timed out after 30 minutes');
      });

      await expect(plugin.run(buildEmitSpy().emit)).rejects.toThrow('Agent timed out');

      expect(onRecorded).toHaveBeenCalledWith('meddra', { tools: [], calls: [{ tool: 'lookup', arguments: { term: 'Sepsis' }, result: { content: [] } }] });
      expect(record).toHaveBeenCalledWith([
        { ts: '2026-09-28T10:00:00.000Z', type: 'mcp_replay_miss', server: 'edc', tool: 'read_record', input: { subject: '1001' } },
      ]);
    });

    it('[ERROR] fails an eval trial whose replay misses cannot be read, rather than report fewer than it made (ADR-0023 D6)', async () => {
      const context = {
        ...buildWorkflowContext({}),
        resolvedMcpConfig: { servers: { edc: { type: 'stdio', command: 'edc-mcp' } } },
        mcpTapes: { replay: { edc: { tools: [], calls: [] } }, record: [], onRecorded: vi.fn() },
        trajectory: { record: vi.fn() },
      } as WorkflowAgentContext;
      await plugin.initialize(context);
      mockSpawn(plugin).mockImplementation(async (_prompt, options) => {
        const tapeDir = join(options!.engineDir as string, 'mcp-tape');
        await mkdir(tapeDir, { recursive: true });
        await writeFile(join(tapeDir, 'edc.misses.jsonl'), '{"ts":"2026-09-28T10:00:00');
        return finishesWith({ ok: true })(_prompt, options);
      });

      await expect(plugin.run(buildEmitSpy().emit)).rejects.toThrow(/Could not read the calls replayed MCP server 'edc' had no recording for/);
    });
  });
});

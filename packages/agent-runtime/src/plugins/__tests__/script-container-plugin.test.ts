import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type {
  AgentContext,
  EmitFn,
  EmitPayload,
  WorkflowAgentContext,
} from '../../interfaces/agent-plugin.js';
import type { ProcessConfig, WorkflowDefinition, WorkflowStep } from '@mediforce/platform-core';
import { ScriptContainerPlugin } from '../script-container-plugin.js';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager.js';

// Only mock `spawn` (used for docker run). Leave the rest of child_process
// real so WorkspaceManager's `execFileSync` calls to git actually work.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

import { spawn } from 'node:child_process';
const spawnMock = vi.mocked(spawn);

function createMockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  Object.assign(child, {
    stdout: new Readable({ read() {} }),
    stderr: new Readable({ read() {} }),
    stdin: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
    pid: 12345,
    killed: false,
    kill: vi.fn(),
  });
  return child;
}

/** Set up spawnMock to return mockChild and emit close after a microtask delay */
function mockSpawnSuccess(mockChild: ChildProcess) {
  spawnMock.mockImplementation(() => {
    // Schedule close event after current microtask (allows listeners to attach)
    setTimeout(() => {
      (mockChild.stdout as Readable).push(null);
      (mockChild.stderr as Readable).push(null);
      mockChild.emit('close', 0, null);
    }, 10);
    return mockChild;
  });
}

function mockSpawnFailure(mockChild: ChildProcess, stderr?: string) {
  spawnMock.mockImplementation(() => {
    setTimeout(() => {
      if (stderr) {
        (mockChild.stderr as Readable).push(Buffer.from(stderr));
      }
      (mockChild.stdout as Readable).push(null);
      (mockChild.stderr as Readable).push(null);
      mockChild.emit('close', 1, null);
    }, 10);
    return mockChild;
  });
}

function buildMockContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'run-script',
    processInstanceId: 'pi-001',
    definitionVersion: 'v1',
    stepInput: { dataFile: '/data/input.csv', parameters: { threshold: 0.5 } },
    autonomyLevel: 'L0',
    config: {
      processName: 'protocol-to-tfl',
      configName: 'default',
      configVersion: 'v1',
      stepConfigs: [
        {
          stepId: 'run-script',
          executorType: 'script',
          plugin: 'script-container',
          agentConfig: {
            image: 'mediforce-r:latest',
            command: 'Rscript /scripts/analyze.R',
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

describe('ScriptContainerPlugin', () => {
  let plugin: ScriptContainerPlugin;

  beforeEach(() => {
    plugin = new ScriptContainerPlugin({ workspaceManager: createFakeWorkspaceManager() });
    spawnMock.mockReset();
  });

  describe('metadata', () => {
    it('[DATA] has descriptive metadata', () => {
      expect(plugin.metadata.name).toBe('Script Container');
      expect(plugin.metadata.description).toContain('script');
      expect(plugin.metadata.description).toContain('Docker');
    });
  });

  describe('initialize', () => {
    it('[DATA] stores image and command from agentConfig', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);
    });

    it('[ERROR] throws if step config not found', async () => {
      const context = buildMockContext({ stepId: 'nonexistent-step' });
      await expect(plugin.initialize(context)).rejects.toThrow(/step config not found/i);
    });

    it('[ERROR] throws if no agentConfig', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            { stepId: 'run-script', executorType: 'script', plugin: 'script-container' },
          ],
        } satisfies ProcessConfig,
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/no agent config/i);
    });

    it('[ERROR] throws if no command configured', async () => {
      const context = buildMockContext({
        config: {
          processName: 'protocol-to-tfl',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'run-script',
              executorType: 'script',
              plugin: 'script-container',
              agentConfig: { image: 'mediforce-r:latest' },
            },
          ],
        } satisfies ProcessConfig,
      });
      await expect(plugin.initialize(context)).rejects.toThrow(/no command/i);
    });
  });

  describe('run', () => {
    it('[DATA] emits status and result events on success', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();
      mockSpawnSuccess(mockChild);

      await plugin.run(emit);

      const statusEvents = events.filter((e) => e.type === 'status');
      expect(statusEvents.length).toBeGreaterThanOrEqual(1);
      expect(statusEvents[0].payload).toContain('mediforce-r:latest');
      expect(statusEvents[0].payload).toContain('Rscript');

      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
    });

    it('[ERROR] throws on Docker failure instead of emitting soft result', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const mockChild = createMockChild();
      mockSpawnFailure(mockChild, 'Error: package not found');

      await expect(plugin.run(emit)).rejects.toThrow(/Script container failed/);
    });

    it('[DATA] inlineScript mode writes script file and invokes it via runtime cmd', async () => {
      const context: AgentContext = {
        ...buildMockContext(),
        config: {
          processName: 'test',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'run-script',
              executorType: 'script',
              plugin: 'script-container',
              agentConfig: {
                runtime: 'bash',
                inlineScript: '#!/bin/sh\necho hello > /workspace/out.txt\n',
              },
            },
          ],
        } satisfies ProcessConfig,
      };
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());

      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const imageIdx = dockerArgs.indexOf('alpine:3.19');
      expect(imageIdx, 'runtime=bash defaults to alpine:3.19').toBeGreaterThan(-1);
      // The command after the image is exactly `sh /output/script.sh` — two tokens,
      // no shell splitting of the user's multi-line bash body.
      expect(dockerArgs.slice(imageIdx + 1)).toEqual(['sh', '/output/script.sh']);
    });

    it('[DATA] command field is whitespace-split argv — complex shell belongs in inlineScript', async () => {
      // This documents the convention: `command` is token-split on whitespace,
      // so it cannot carry shell operators like quotes, pipes, or `&&`.
      // A command like `bash -c "echo hi && echo bye"` would be split into
      // ['bash', '-c', '"echo', 'hi', '&&', 'echo', 'bye"'] — silently broken.
      // Use `inlineScript + runtime` for anything with shell syntax.
      const context: AgentContext = {
        ...buildMockContext(),
        config: {
          processName: 'test',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [
            {
              stepId: 'run-script',
              executorType: 'script',
              plugin: 'script-container',
              agentConfig: {
                image: 'debian:bookworm-slim',
                command: 'bash -c "echo hi && echo bye"',
              },
            },
          ],
        } satisfies ProcessConfig,
      };
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());

      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const imageIdx = dockerArgs.indexOf('debian:bookworm-slim');
      // These are the mangled tokens — the quotes are left in, shell operators
      // are passed as argv. The bash process will see a nonsense command.
      expect(dockerArgs.slice(imageIdx + 1)).toEqual([
        'bash', '-c', '"echo', 'hi', '&&', 'echo', 'bye"',
      ]);
    });

    it('[DATA] passes correct docker args including volume mount and command', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const mockChild = createMockChild();
      mockSpawnSuccess(mockChild);

      await plugin.run(emit);

      expect(spawnMock).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining([
          'run', '--rm',
          '--memory', '8g',
          '--cpus', '2',
          'mediforce-r:latest',
          'Rscript',
          '/scripts/analyze.R',
        ]),
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'pipe'] }),
      );

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const volumeIdx = dockerArgs.indexOf('-v');
      expect(volumeIdx).toBeGreaterThan(-1);
      expect(dockerArgs[volumeIdx + 1]).toMatch(/.*:\/output$/);
    });

    it('[DATA] streams stdout lines as assistant events as they arrive (live, before close)', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();

      // Capture how many assistant events were already emitted at the moment
      // we push each stdout chunk. If streaming is live, each push grows the
      // count BEFORE we ever emit `close`. Without live streaming, all the
      // assistant events appear only after `close`.
      const eventCountAtChunkEmit: number[] = [];

      spawnMock.mockImplementation(() => {
        const stdout = mockChild.stdout as Readable;
        // Schedule three chunks then close, with microtask spacing so we can
        // observe interleaved emits.
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          stdout.push('row 1 processed\n');
          await new Promise((r) => setTimeout(r, 5));
          eventCountAtChunkEmit.push(events.filter((e) => e.type === 'assistant').length);

          stdout.push('row 2 processed\n');
          await new Promise((r) => setTimeout(r, 5));
          eventCountAtChunkEmit.push(events.filter((e) => e.type === 'assistant').length);

          stdout.push('row 3 processed\n');
          await new Promise((r) => setTimeout(r, 5));
          eventCountAtChunkEmit.push(events.filter((e) => e.type === 'assistant').length);

          stdout.push(null);
          (mockChild.stderr as Readable).push(null);
          mockChild.emit('close', 0, null);
        })();
        return mockChild;
      });

      await plugin.run(emit);

      // The counts captured BEFORE close should reflect live arrival.
      // After chunk 1 there should be at least 1 event, etc.
      expect(eventCountAtChunkEmit[0]).toBeGreaterThanOrEqual(1);
      expect(eventCountAtChunkEmit[1]).toBeGreaterThanOrEqual(2);
      expect(eventCountAtChunkEmit[2]).toBeGreaterThanOrEqual(3);

      const assistantEvents = events.filter((e) => e.type === 'assistant');
      const texts = assistantEvents.map((e) => {
        const parsed = JSON.parse(e.payload as string) as { text: string };
        return parsed.text;
      });
      expect(texts).toContain('row 1 processed');
      expect(texts).toContain('row 2 processed');
      expect(texts).toContain('row 3 processed');
    });

    it('[DATA] streams stderr lines as [stderr]-prefixed assistant events and filters the docker container-ID preamble', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();

      spawnMock.mockImplementation(() => {
        const stderr = mockChild.stderr as Readable;
        const stdout = mockChild.stdout as Readable;
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          // `docker run` writes the standalone container-ID first — must NOT surface to UI.
          stderr.push('a3f8c9d2e4b1\n');
          await new Promise((r) => setTimeout(r, 5));
          stderr.push('Warning: deprecated flag\n');
          await new Promise((r) => setTimeout(r, 5));
          stderr.push('R version 4.4.1 banner\n');
          stdout.push(null);
          stderr.push(null);
          mockChild.emit('close', 0, null);
        })();
        return mockChild;
      });

      await plugin.run(emit);

      const texts = events
        .filter((e) => e.type === 'assistant')
        .map((e) => (JSON.parse(e.payload as string) as { text: string }).text);

      expect(texts).toContain('[stderr] Warning: deprecated flag');
      expect(texts).toContain('[stderr] R version 4.4.1 banner');
      expect(
        texts.some((t) => /[0-9a-f]{12,64}/.test(t)),
        'standalone docker container-ID line must be filtered from the activity feed',
      ).toBe(false);
    });

    it('[DATA] result event lands after every preceding live activity event (no UI completed-before-output flicker)', async () => {
      // Plugin issues live emits as fire-and-forget while the container runs, then awaits
      // the result emit. With FirestoreAgentEventLog's per-step chain serialization,
      // awaiting the result waits for every queued live emit — so result.sequence is
      // strictly greater than every assistant.sequence. Tested here at the plugin level
      // by checking emission order through the in-memory spy (which preserves call order).
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();
      spawnMock.mockImplementation(() => {
        const stdout = mockChild.stdout as Readable;
        void (async () => {
          await new Promise((r) => setTimeout(r, 5));
          stdout.push('progress 1\nprogress 2\nprogress 3\n');
          await new Promise((r) => setTimeout(r, 5));
          stdout.push(null);
          (mockChild.stderr as Readable).push(null);
          mockChild.emit('close', 0, null);
        })();
        return mockChild;
      });

      await plugin.run(emit);

      const lastIdx = events.length - 1;
      expect(events[lastIdx].type).toBe('result');
      let lastAssistantIdx = -1;
      for (let i = 0; i < events.length; i += 1) {
        if (events[i].type === 'assistant') lastAssistantIdx = i;
      }
      expect(lastAssistantIdx).toBeLessThan(lastIdx);
    });

    it('[DATA] writes input.json to the output directory', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      const mockChild = createMockChild();
      let capturedOutputDir: string | null = null;

      spawnMock.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        const vIdx = argsArr.indexOf('-v');
        if (vIdx >= 0) {
          capturedOutputDir = argsArr[vIdx + 1].split(':')[0];
        }

        setTimeout(async () => {
          if (capturedOutputDir) {
            const inputContent = await readFile(join(capturedOutputDir, 'input.json'), 'utf-8');
            const parsed = JSON.parse(inputContent);
            expect(parsed.dataFile).toBe('/data/input.csv');
            expect(parsed.parameters.threshold).toBe(0.5);
          }
          (mockChild.stdout as Readable).push(null);
          (mockChild.stderr as Readable).push(null);
          mockChild.emit('close', 0, null);
        }, 10);

        return mockChild;
      });

      await plugin.run(emit);

      expect(capturedOutputDir).not.toBeNull();
    });
  });

  describe('connections (workflow context)', () => {
    function buildWorkflowContext(
      resolvedConnectionEnv: Record<string, string> | undefined,
    ): WorkflowAgentContext {
      const step: WorkflowStep = {
        id: 'run-script',
        name: 'Run Script',
        type: 'creation',
        executor: 'script',
        agent: { image: 'mediforce-r:latest', command: 'Rscript /scripts/run.R' },
        env: { EXISTING_VAR: 'literal-value' },
        ...(resolvedConnectionEnv !== undefined ? { connections: ['github-mediforce'] } : {}),
      };
      const workflowDefinition: WorkflowDefinition = {
        name: 'test-wf',
        version: 1,
        namespace: 'test',
        steps: [step],
        transitions: [],
        triggers: [{ type: 'manual', name: 'Start' }],
      };
      return {
        stepId: 'run-script',
        processInstanceId: 'pi-001',
        definitionVersion: '1',
        stepInput: {},
        autonomyLevel: 'L4',
        workflowDefinition,
        step,
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
        ...(resolvedConnectionEnv !== undefined ? { resolvedConnectionEnv } : {}),
      };
    }

    it('[DATA] merges resolvedConnectionEnv into the docker -e env flags', async () => {
      const context = buildWorkflowContext({
        CONN_GITHUB_MEDIFORCE_TOKEN: 'gho_secret_abc',
        GITHUB_TOKEN: 'gho_secret_abc',
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());
      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const envEntries: string[] = [];
      for (let i = 0; i < dockerArgs.length - 1; i += 1) {
        if (dockerArgs[i] === '-e') envEntries.push(dockerArgs[i + 1]);
      }
      expect(envEntries).toContain('CONN_GITHUB_MEDIFORCE_TOKEN=gho_secret_abc');
      expect(envEntries).toContain('GITHUB_TOKEN=gho_secret_abc');
      expect(envEntries).toContain('EXISTING_VAR=literal-value');
    });

    it('[DATA] runs without connection env when no connections requested', async () => {
      const context = buildWorkflowContext(undefined);
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());
      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const envEntries: string[] = [];
      for (let i = 0; i < dockerArgs.length - 1; i += 1) {
        if (dockerArgs[i] === '-e') envEntries.push(dockerArgs[i + 1]);
      }
      // Existing step env is still present, no CONN_ vars sneak in.
      expect(envEntries).toContain('EXISTING_VAR=literal-value');
      expect(envEntries.find((e) => e.startsWith('CONN_'))).toBeUndefined();
    });

    it('[DATA] step env wins over connection env on key collision', async () => {
      const context = buildWorkflowContext({
        CONN_GITHUB_MEDIFORCE_TOKEN: 'from-connection',
        EXISTING_VAR: 'from-connection',
      });
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());
      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const envEntries: string[] = [];
      for (let i = 0; i < dockerArgs.length - 1; i += 1) {
        if (dockerArgs[i] === '-e') envEntries.push(dockerArgs[i + 1]);
      }
      // Step-level env wins (literal-value), not the connection-injected value.
      expect(envEntries).toContain('EXISTING_VAR=literal-value');
      expect(envEntries).toContain('CONN_GITHUB_MEDIFORCE_TOKEN=from-connection');
    });

    it('[DATA] step env shadows a CONN_<ID>_TOKEN injected by the connection layer', async () => {
      // Workflow-level env explicitly sets CONN_GITHUB_MEDIFORCE_TOKEN to a
      // literal — the connection-resolved token must NOT overwrite it. This
      // is the documented "debug hatch" precedence; the test pins it so a
      // future precedence flip surfaces here loudly.
      const step: WorkflowStep = {
        id: 'run-script',
        name: 'Run Script',
        type: 'creation',
        executor: 'script',
        agent: { image: 'mediforce-r:latest', command: 'Rscript /scripts/run.R' },
        env: { CONN_GITHUB_MEDIFORCE_TOKEN: 'literal-debug-override' },
        connections: ['github-mediforce'],
      };
      const workflowDefinition: WorkflowDefinition = {
        name: 'test-wf',
        version: 1,
        namespace: 'test',
        steps: [step],
        transitions: [],
        triggers: [{ type: 'manual', name: 'Start' }],
      };
      const context: WorkflowAgentContext = {
        stepId: 'run-script',
        processInstanceId: 'pi-001',
        definitionVersion: '1',
        stepInput: {},
        autonomyLevel: 'L4',
        workflowDefinition,
        step,
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
        resolvedConnectionEnv: { CONN_GITHUB_MEDIFORCE_TOKEN: 'from-connection-resolver' },
      };
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());
      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      const envEntries: string[] = [];
      for (let i = 0; i < dockerArgs.length - 1; i += 1) {
        if (dockerArgs[i] === '-e') envEntries.push(dockerArgs[i + 1]);
      }
      expect(envEntries).toContain('CONN_GITHUB_MEDIFORCE_TOKEN=literal-debug-override');
      expect(envEntries).not.toContain('CONN_GITHUB_MEDIFORCE_TOKEN=from-connection-resolver');
    });
  });
});

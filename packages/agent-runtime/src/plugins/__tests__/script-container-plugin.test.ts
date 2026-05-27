import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { AgentContext, WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
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

    it('[ERROR] empty stdout/stderr failure surfaces image, command, env keys, input size — and writes the diagnostic to the activity log', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();
      mockSpawnFailure(mockChild); // exit 1 with no stdout/stderr

      const error = await plugin.run(emit).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('no stdout/stderr/result captured');
      expect(message).toContain('image=mediforce-r:latest');
      expect(message).toContain('cmd=Rscript /scripts/analyze.R');
      // RUN_ID / STEP_ID are injected into every container, so the diagnostic
      // must list them even though they aren't user-declared env vars.
      expect(message).toContain('env=[RUN_ID,STEP_ID]');
      expect(message).toMatch(/inputSize=\d+b/);

      // The Step Log panel reads the activity log file, which is fed by
      // assistant events — the no-output diagnostic must land there, not only
      // in the status channel that the panel ignores.
      const assistantTexts = events
        .filter((e) => e.type === 'assistant')
        .map((e) => (JSON.parse(e.payload as string) as { text: string }).text);
      expect(assistantTexts.some((t) => t.includes('no stdout/stderr/result captured'))).toBe(true);
    });

    it('[ERROR] no-output failure surfaces the error the script wrote to result.json', async () => {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();

      // Reproduce the workflow-designer register/validate failure: the script
      // writes its reason to result.json and exits 1 with no stdout/stderr.
      spawnMock.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        const vIdx = argsArr.indexOf('-v');
        const capturedDir = vIdx >= 0 ? argsArr[vIdx + 1].split(':')[0] : null;
        setTimeout(async () => {
          if (capturedDir) {
            await writeFile(
              join(capturedDir, 'result.json'),
              JSON.stringify({ registered: false, error: 'Missing MEDIFORCE_RUN_NAMESPACE env var' }),
              'utf-8',
            );
          }
          (mockChild.stdout as Readable).push(null);
          (mockChild.stderr as Readable).push(null);
          mockChild.emit('close', 1, null);
        }, 10);
        return mockChild;
      });

      const error = await plugin.run(emit).catch((e: unknown) => e);
      expect((error as Error).message).toContain('result.json error: Missing MEDIFORCE_RUN_NAMESPACE env var');

      // …and the reason reaches the activity log the Step Log panel renders.
      const assistantTexts = events
        .filter((e) => e.type === 'assistant')
        .map((e) => (JSON.parse(e.payload as string) as { text: string }).text);
      expect(assistantTexts.some((t) => t.includes('result.json error: Missing MEDIFORCE_RUN_NAMESPACE env var'))).toBe(true);
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

    it('[DATA] injects MEDIFORCE_RUN_NAMESPACE env from the run namespace (WorkflowAgentContext)', async () => {
      const context: WorkflowAgentContext = {
        stepId: 'register',
        processInstanceId: 'pi-acme',
        runNamespace: 'acme',
        definitionVersion: '1',
        stepInput: {},
        autonomyLevel: 'L4',
        workflowDefinition: buildWorkflowDefinition({
          name: 'workflow-designer',
          version: 1,
          namespace: 'appsilon',
          steps: [],
          transitions: [],
        }),
        step: {
          id: 'register',
          name: 'Register',
          type: 'creation',
          executor: 'script',
          agent: { runtime: 'bash', inlineScript: '#!/bin/sh\necho ok\n' },
        },
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnSuccess(createMockChild());

      await plugin.run(emit);

      const dockerArgs = spawnMock.mock.calls[0][1] as string[];
      // The run's namespace (acme) — NOT the WD's home namespace (appsilon) —
      // is what steps act on. Register scripts read it to target the right org.
      expect(dockerArgs).toContain('MEDIFORCE_RUN_NAMESPACE=acme');
    });

    it('[ERROR] no-output diagnostic lists MEDIFORCE_RUN_NAMESPACE for workflow runs', async () => {
      const context: WorkflowAgentContext = {
        stepId: 'register',
        processInstanceId: 'pi-acme',
        runNamespace: 'acme',
        definitionVersion: '1',
        stepInput: {},
        autonomyLevel: 'L4',
        workflowDefinition: buildWorkflowDefinition({
          name: 'workflow-designer',
          version: 1,
          namespace: 'appsilon',
          steps: [],
          transitions: [],
        }),
        step: {
          id: 'register',
          name: 'Register',
          type: 'creation',
          executor: 'script',
          agent: { runtime: 'bash', inlineScript: '#!/bin/sh\necho ok\n' },
        },
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await plugin.initialize(context);

      const { emit } = buildEmitSpy();
      mockSpawnFailure(createMockChild()); // exit 1 with no stdout/stderr

      const error = await plugin.run(emit).catch((e: unknown) => e);
      // The diagnostic must reflect every injected var the script saw — RUN_ID
      // and STEP_ID plus the run namespace #539 injects for workflow runs.
      expect((error as Error).message).toContain('env=[RUN_ID,STEP_ID,MEDIFORCE_RUN_NAMESPACE]');
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

  describe('presentation', () => {
    async function runWithPresentationFiles(
      filesToWrite: Record<string, string>,
    ): Promise<{ events: EmitPayload[] }> {
      const context = buildMockContext();
      await plugin.initialize(context);

      const { emit, events } = buildEmitSpy();
      const mockChild = createMockChild();

      spawnMock.mockImplementation((_cmd, args) => {
        const argsArr = args as string[];
        const vIdx = argsArr.indexOf('-v');
        const capturedDir = vIdx >= 0 ? argsArr[vIdx + 1].split(':')[0] : null;

        setTimeout(async () => {
          if (capturedDir) {
            for (const [name, content] of Object.entries(filesToWrite)) {
              await writeFile(join(capturedDir, name), content, 'utf-8');
            }
          }
          (mockChild.stdout as Readable).push(null);
          (mockChild.stderr as Readable).push(null);
          mockChild.emit('close', 0, null);
        }, 10);

        return mockChild;
      });

      await plugin.run(emit);
      return { events };
    }

    it('[DATA] emits presentation.kind=markdown when only presentation.md is written', async () => {
      const { events } = await runWithPresentationFiles({
        'presentation.md': '# Status\n\n- one\n- two',
      });
      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent?.payload as { presentation?: { kind: string; content: string } };
      expect(payload.presentation).toEqual({
        kind: 'markdown',
        content: '# Status\n\n- one\n- two',
      });
    });

    it('[DATA] falls back to presentation.kind=html when only presentation.html is written', async () => {
      const { events } = await runWithPresentationFiles({
        'presentation.html': '<section>HTML body</section>',
      });
      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent?.payload as { presentation?: { kind: string; content: string } };
      expect(payload.presentation).toEqual({
        kind: 'html',
        content: '<section>HTML body</section>',
      });
    });

    it('[DATA] prefers presentation.md over presentation.html when both are written', async () => {
      const { events } = await runWithPresentationFiles({
        'presentation.md': '# Markdown wins',
        'presentation.html': '<h1>HTML loses</h1>',
      });
      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent?.payload as { presentation?: { kind: string; content: string } };
      expect(payload.presentation?.kind).toBe('markdown');
      expect(payload.presentation?.content).toBe('# Markdown wins');
    });

    it('[DATA] omits presentation when neither file is written', async () => {
      const { events } = await runWithPresentationFiles({});
      const resultEvent = events.find((e) => e.type === 'result');
      const payload = resultEvent?.payload as Record<string, unknown>;
      expect(payload).not.toHaveProperty('presentation');
    });
  });
});

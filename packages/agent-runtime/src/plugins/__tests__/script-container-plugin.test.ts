import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';
import { ScriptContainerPlugin } from '../script-container-plugin.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

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
    plugin = new ScriptContainerPlugin();
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
          '--memory', '4g',
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
});

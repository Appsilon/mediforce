/**
 * Integration test for the end-to-end agent log flow:
 *
 *   ClaudeCodeAgentPlugin.run()
 *     → BaseContainerAgentPlugin.spawnDockerContainer()
 *       → DockerSpawnStrategy.spawn() (fake — emits stream-json lines via onStdoutLine)
 *         → $TMPDIR/mediforce-agent-logs/<instance>_<step>_<ts>.log
 *
 * The fake strategy simulates a real Docker run by invoking onStdoutLine with
 * synthetic stream-json events at controlled times, then resolving with the
 * final result event. We assert:
 *
 *   1. The log file appears on disk WHILE the spawn is still running (real-time
 *      streaming) — the regression that PR #215 fixes.
 *   2. After the run completes, the log contains one JSONL entry per observable
 *      stream-json event (tool_call, tool_result, assistant text, result).
 *   3. The run() emits a status event advertising the log file path (consumed
 *      by the process-detail page to populate the Agent Log tab).
 *
 * This is the closest thing to an end-to-end agent-log test that does not
 * require a real Docker daemon, Claude CLI, or Firestore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  DockerSpawnRequest,
  DockerSpawnResult,
  DockerSpawnStrategy,
} from '../docker-spawn-strategy.js';

// --- Mock getDockerSpawnStrategy so the plugin picks up our fake -------------
let activeStrategy: DockerSpawnStrategy | null = null;
vi.mock('../docker-spawn-strategy.js', async () => {
  const actual = await vi.importActual<typeof import('../docker-spawn-strategy.js')>(
    '../docker-spawn-strategy.js',
  );
  return {
    ...actual,
    getDockerSpawnStrategy: (): DockerSpawnStrategy => activeStrategy!,
  };
});

// Avoid writing prompt.txt / mcp-config / reading real skill files.
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return actual;
});

import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin.js';
import type { AgentContext, EmitFn, EmitPayload } from '../../interfaces/agent-plugin.js';
import type { ProcessConfig } from '@mediforce/platform-core';

const LOGS_DIR = join(tmpdir(), 'mediforce-agent-logs');

/** Build a fake strategy that drives onStdoutLine according to a script of
 *  (delayMs, line) pairs, then resolves with a final stream-json result event. */
function makeScriptedStrategy(
  script: Array<{ delayMs: number; line: string }>,
  finalResultLine: string,
  events: { readyToAssertMidRun?: () => void },
): { strategy: DockerSpawnStrategy; completion: Promise<void> } {
  let resolveCompletion!: () => void;
  const completion = new Promise<void>((r) => { resolveCompletion = r; });

  const strategy: DockerSpawnStrategy = {
    async spawn(request: DockerSpawnRequest): Promise<DockerSpawnResult> {
      const stdoutAccum: string[] = [];

      for (const { delayMs, line } of script) {
        await new Promise((r) => setTimeout(r, delayMs));
        stdoutAccum.push(line);
        if (request.onStdoutLine) {
          await request.onStdoutLine(line);
        }
      }

      // Signal the test it may now assert mid-run state (log file exists and
      // has entries) BEFORE we resolve with the final result.
      events.readyToAssertMidRun?.();
      // Yield so the test can observe state before we resolve.
      await new Promise((r) => setTimeout(r, 50));

      stdoutAccum.push(finalResultLine);
      if (request.onStdoutLine) {
        await request.onStdoutLine(finalResultLine);
      }

      resolveCompletion();

      return {
        stdout: stdoutAccum.join('\n') + '\n',
        stderr: '',
        exitCode: 0,
        signal: null,
      };
    },
  };

  return { strategy, completion };
}

function buildContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    stepId: 'extract',
    processInstanceId: `pi-${Math.random().toString(36).slice(2, 10)}`,
    definitionVersion: 'v1',
    stepInput: { filePaths: ['/data/protocol.pdf'] },
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

function captureEmit(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = async (event: EmitPayload) => { events.push(event); };
  return { emit, events };
}

/** Stub out skill file reads so the test does not depend on repo layout. */
function stubReadSkill(plugin: ClaudeCodeAgentPlugin) {
  return vi
    .spyOn(plugin as unknown as { readSkillFile: (d: string, s: string) => Promise<string> }, 'readSkillFile')
    .mockResolvedValue('# Test skill — extract metadata.');
}

describe('agent log streaming — end-to-end through ClaudeCodeAgentPlugin', () => {
  beforeEach(async () => {
    await mkdir(LOGS_DIR, { recursive: true });
  });

  afterEach(() => {
    activeStrategy = null;
    vi.restoreAllMocks();
  });

  it('writes log entries to the on-disk log file while the container is still running', async () => {
    // stream-json lines a real Claude CLI would emit — three tool calls, then a
    // final result event. Each line is a valid JSON object on its own.
    const toolCall = (name: string) => JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name, input: { file_path: `/data/${name}.pdf` } }] },
    });
    const assistantText = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Extracted metadata.' }] },
    });
    const resultLine = JSON.stringify({
      type: 'result',
      subtype: 'success',
      result: JSON.stringify({ output_file: '/output/result.json', summary: 'ok' }),
    });

    let midRunSnapshot: { existedDuringRun: boolean; entriesDuringRun: number } | null = null;

    const { strategy } = makeScriptedStrategy(
      [
        { delayMs: 10, line: toolCall('Read') },
        { delayMs: 10, line: toolCall('Grep') },
        { delayMs: 10, line: assistantText },
      ],
      resultLine,
      {
        readyToAssertMidRun: () => {
          // Capture synchronously before resolve — this runs while strategy.spawn() is still pending.
          // We wrap in try/catch because the assertion happens in a microtask context.
          try {
            const fileName = findLogFile();
            if (fileName) {
              const content = readFileSync(join(LOGS_DIR, fileName));
              midRunSnapshot = {
                existedDuringRun: true,
                entriesDuringRun: content.split('\n').filter(Boolean).length,
              };
            } else {
              midRunSnapshot = { existedDuringRun: false, entriesDuringRun: 0 };
            }
          } catch (err) {
            midRunSnapshot = { existedDuringRun: false, entriesDuringRun: -1 };
          }
        },
      },
    );
    activeStrategy = strategy;

    const plugin = new ClaudeCodeAgentPlugin();
    stubReadSkill(plugin);

    const context = buildContext();
    await plugin.initialize(context);

    const { emit, events } = captureEmit();

    // Seed known file names we can find post-hoc. We snapshot the dir contents
    // before/after so we can identify the file created by this run.
    const beforeFiles = await safeReaddir(LOGS_DIR);
    await plugin.run(emit);
    const afterFiles = await safeReaddir(LOGS_DIR);
    const newFiles = afterFiles.filter((f) => !beforeFiles.includes(f) && f.startsWith(context.processInstanceId));

    // --- 1. Log file was created and populated WHILE the spawn was still running
    expect(midRunSnapshot).not.toBeNull();
    expect(midRunSnapshot!.existedDuringRun).toBe(true);
    expect(midRunSnapshot!.entriesDuringRun).toBeGreaterThanOrEqual(3);

    // --- 2. After the run, the log file contains one entry per observable event
    expect(newFiles).toHaveLength(1);
    const finalContent = await readFile(join(LOGS_DIR, newFiles[0]), 'utf-8');
    const entries = finalContent.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

    expect(entries.map((e) => ({ type: e.type, subtype: e.subtype, tool: e.tool }))).toEqual([
      { type: 'assistant', subtype: 'tool_call', tool: 'Read' },
      { type: 'assistant', subtype: 'tool_call', tool: 'Grep' },
      { type: 'assistant', subtype: 'text', tool: undefined },
      { type: 'result', subtype: 'success', tool: undefined },
    ]);

    // --- 3. run() emitted the status event the UI uses to locate the log file
    const logFileStatus = events.find(
      (e) => e.type === 'status' && typeof e.payload === 'string' && e.payload.startsWith('agent activity log:'),
    );
    expect(logFileStatus).toBeDefined();
    const advertisedPath = (logFileStatus!.payload as string).replace('agent activity log: ', '');
    expect(advertisedPath).toBe(join(LOGS_DIR, newFiles[0]));

    // Result event was emitted with the extracted summary
    const resultEvent = events.find((e) => e.type === 'result');
    expect(resultEvent).toBeDefined();
  });

  it('does not populate the log file if the strategy emits no lines before resolving', async () => {
    const { strategy } = makeScriptedStrategy(
      [],
      JSON.stringify({ type: 'result', subtype: 'success', result: '{}' }),
      {},
    );
    activeStrategy = strategy;

    const plugin = new ClaudeCodeAgentPlugin();
    stubReadSkill(plugin);

    const context = buildContext();
    await plugin.initialize(context);

    const beforeFiles = await safeReaddir(LOGS_DIR);
    await plugin.run(captureEmit().emit);
    const afterFiles = await safeReaddir(LOGS_DIR);
    const newFiles = afterFiles.filter((f) => !beforeFiles.includes(f) && f.startsWith(context.processInstanceId));

    // The file is created eagerly (so the UI can show an empty "waiting" state),
    // but it should contain only the final result line.
    expect(newFiles).toHaveLength(1);
    const content = await readFile(join(LOGS_DIR, newFiles[0]), 'utf-8');
    const entries = content.split('\n').filter(Boolean);
    expect(entries).toHaveLength(1);
    expect(JSON.parse(entries[0])).toMatchObject({ type: 'result', subtype: 'success' });
  });
});

// --- local helpers ----------------------------------------------------------

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import('node:fs/promises');
    return await readdir(dir);
  } catch {
    return [];
  }
}

function findLogFile(): string | null {
  // Sync helper for use inside the mid-run callback (which cannot await).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  try {
    const files = fs.readdirSync(LOGS_DIR);
    // Pick the most recently modified file — that's our in-flight run.
    return files
      .map((f) => ({ f, m: fs.statSync(join(LOGS_DIR, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m)[0]?.f ?? null;
  } catch {
    return null;
  }
}

function readFileSync(path: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  return fs.readFileSync(path, 'utf-8');
}

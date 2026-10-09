import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/step-executor-plugin';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin';
import { OpenCodeAgentPlugin } from '../opencode-agent-plugin';
import type { BaseContainerAgentPlugin } from '../base-container-agent-plugin';
import { createFakeWorkspaceManager } from './helpers/fake-workspace-manager';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn() };
});

vi.mock('@mediforce/container-worker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mediforce/container-worker')>();
  return { ...actual, removeStaleContainer: vi.fn().mockResolvedValue(undefined) };
});

import { spawn } from 'node:child_process';
const spawnMock = vi.mocked(spawn);

const CLAUDE_RESULT_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: JSON.stringify({ summary: 'done' }),
});

const OPENCODE_RESULT_LINE = JSON.stringify({
  type: 'text',
  part: { type: 'text', text: JSON.stringify({ summary: 'done' }) },
});

let seeded: Record<string, unknown> | null = null;
let seededPrompt: string | null = null;
let dockerArgs: readonly string[] = [];

function mockCliSuccess(resultLine: string): void {
  spawnMock.mockImplementation((_cmd: string, args?: readonly string[]) => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, {
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      stdin: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
      pid: 4242,
      killed: false,
      kill: vi.fn(),
    });
    const mount = (args ?? []).find((arg) => arg.endsWith(':/output'));
    const hostDir = mount?.slice(0, -':/output'.length) ?? '';
    dockerArgs = args ?? [];
    setTimeout(() => {
      void readFile(join(hostDir, 'input.json'), 'utf-8')
        .then((raw) => { seeded = JSON.parse(raw) as Record<string, unknown>; })
        .catch(() => { seeded = null; })
        .then(() => readFile(join(hostDir, 'prompt.txt'), 'utf-8'))
        .then((prompt) => { seededPrompt = prompt; })
        .catch(() => { seededPrompt = null; })
        .finally(() => {
          (child.stdout as Readable).push(`${resultLine}\n`);
          (child.stdout as Readable).push(null);
          (child.stderr as Readable).push(null);
          child.emit('close', 0, null);
        });
    }, 10);
    return child;
  });
}

function buildContext(pluginId: string, stepInput: Record<string, unknown>): WorkflowAgentContext {
  const step = {
    id: 'test-application',
    name: 'Test Application',
    type: 'creation' as const,
    executor: 'agent' as const,
    plugin: pluginId,
    agent: { prompt: 'Test the app.', image: 'mediforce-golden-image' },
  };
  return {
    stepId: 'test-application',
    processInstanceId: 'pi-input-file',
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput,
    autonomyLevel: 'L4',
    workflowDefinition: buildWorkflowDefinition({
      name: 'tealflow', version: 1, namespace: 'acme', steps: [step], transitions: [],
    }),
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  };
}

const noopEmit: EmitFn = async (_event: EmitPayload) => undefined;

const plugins = [
  {
    pluginId: 'claude-code-agent',
    resultLine: CLAUDE_RESULT_LINE,
    create: (): BaseContainerAgentPlugin => new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() }),
  },
  {
    pluginId: 'opencode-agent',
    resultLine: OPENCODE_RESULT_LINE,
    create: (): BaseContainerAgentPlugin => new OpenCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() }),
  },
];

describe.each(plugins)('a $pluginId step reads its input from /output/input.json', ({ pluginId, resultLine, create }) => {
  let plugin: BaseContainerAgentPlugin;

  beforeEach(() => {
    plugin = create();
    spawnMock.mockReset();
    seeded = null;
    seededPrompt = null;
    dockerArgs = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('seeds the file the docs promise, with the same input the prompt carries', async () => {
    const stepInput = {
      improved_code: 'library(teal)',
      steps: { 'review-and-improve-code': { improved_code: 'library(teal)' } },
    };
    await plugin.initialize(buildContext(pluginId, stepInput));
    mockCliSuccess(resultLine);

    await plugin.run(noopEmit);

    expect(seeded).toEqual(stepInput);
  });

  it('points uploaded files at the /data mount the container sees, not the host temp dir', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('xpt-bytes', { status: 200 })));
    const stepInput = {
      files: [{ name: 'ae.xpt', downloadUrl: '/api/attachments/abc/blob', storagePath: 'abc' }],
    };
    await plugin.initialize(buildContext(pluginId, stepInput));
    mockCliSuccess(resultLine);

    await plugin.run(noopEmit);

    const seededFiles = (seeded as { files: Array<{ localPath: string }> }).files;
    expect(seededFiles[0].localPath).toBe('/data/0/ae.xpt');
    expect(seededPrompt).toContain('"localPath": "/data/0/ae.xpt"');
    expect(seededPrompt).not.toContain('mediforce-agent-');
    expect(dockerArgs.some((arg) => arg.endsWith(':/data:ro'))).toBe(true);
  });
});

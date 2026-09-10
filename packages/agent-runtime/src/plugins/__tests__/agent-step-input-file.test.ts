import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/step-executor-plugin';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { ClaudeCodeAgentPlugin } from '../claude-code-agent-plugin';
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

const RESULT_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: JSON.stringify({ summary: 'done' }),
});

let seeded: Record<string, unknown> | null = null;

function mockCliSuccess(): void {
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
    setTimeout(() => {
      void readFile(join(hostDir, 'input.json'), 'utf-8')
        .then((raw) => { seeded = JSON.parse(raw) as Record<string, unknown>; })
        .catch(() => { seeded = null; })
        .finally(() => {
          (child.stdout as Readable).push(`${RESULT_LINE}\n`);
          (child.stdout as Readable).push(null);
          (child.stderr as Readable).push(null);
          child.emit('close', 0, null);
        });
    }, 10);
    return child;
  });
}

function buildContext(stepInput: Record<string, unknown>): WorkflowAgentContext {
  const step = {
    id: 'test-application',
    name: 'Test Application',
    type: 'creation' as const,
    executor: 'agent' as const,
    plugin: 'claude-code-agent',
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

describe('an agent step reads its input from /output/input.json', () => {
  let plugin: ClaudeCodeAgentPlugin;

  beforeEach(() => {
    plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    spawnMock.mockReset();
    seeded = null;
  });

  it('seeds the file the docs promise, with the same input the prompt carries', async () => {
    const stepInput = {
      improved_code: 'library(teal)',
      steps: { 'review-and-improve-code': { improved_code: 'library(teal)' } },
    };
    await plugin.initialize(buildContext(stepInput));
    mockCliSuccess();

    await plugin.run(noopEmit);

    expect(seeded).toEqual(stepInput);
  });
});

/**
 * The workflow's own files reaching an *agent* container. Agents already get a
 * `/plugin` mount for a git-checked-out skills directory; this covers the mount
 * that needs no checkout, so the same definition runs on an instance that has
 * never seen the repository.
 */
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

function mockCliSuccess(): void {
  spawnMock.mockImplementation(() => {
    const child = new EventEmitter() as ChildProcess;
    Object.assign(child, {
      stdout: new Readable({ read() {} }),
      stderr: new Readable({ read() {} }),
      stdin: new Writable({ write(_chunk, _enc, cb) { cb(); } }),
      pid: 4242,
      killed: false,
      kill: vi.fn(),
    });
    setTimeout(() => {
      (child.stdout as Readable).push(`${RESULT_LINE}\n`);
      (child.stdout as Readable).push(null);
      (child.stderr as Readable).push(null);
      child.emit('close', 0, null);
    }, 10);
    return child;
  });
}

function buildContext(artifacts?: { path: string; contents: string }[]): WorkflowAgentContext {
  const step = {
    id: 'interpret',
    name: 'Interpret validation',
    type: 'creation' as const,
    executor: 'agent' as const,
    plugin: 'claude-code-agent',
    agent: { skill: 'data-validator', image: 'mediforce-landing-zone:latest' },
  };
  return {
    stepId: 'interpret',
    processInstanceId: `pi-${Math.random().toString(36).slice(2, 8)}`,
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput: {},
    autonomyLevel: 'L2',
    workflowDefinition: buildWorkflowDefinition({
      name: 'landing-zone',
      version: 1,
      namespace: 'acme',
      steps: [step],
      transitions: [],
      ...(artifacts === undefined ? {} : { artifacts }),
    }),
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  };
}

const noopEmit: EmitFn = async (_event: EmitPayload) => undefined;

describe('ClaudeCodeAgentPlugin — workflow artifacts', () => {
  let plugin: ClaudeCodeAgentPlugin;

  beforeEach(() => {
    plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    spawnMock.mockReset();
    vi.spyOn(
      plugin as unknown as { readSkillFile: (dir: string, skill: string) => Promise<string> },
      'readSkillFile',
    ).mockResolvedValue('# Data validator\n');
  });

  it('mounts the files the workflow carries at /artifacts, read-only', async () => {
    await plugin.initialize(buildContext([
      { path: 'skills/data-validator/SKILL.md', contents: '# Data validator\n' },
      { path: 'scripts/report.py', contents: 'print("report")\n' },
    ]));
    mockCliSuccess();

    await plugin.run(noopEmit);

    const dockerArgs = spawnMock.mock.calls[0][1] as string[];
    const mount = dockerArgs.find((arg) => arg.endsWith(':/artifacts:ro'));
    expect(mount, 'artifacts are mounted read-only').toBeDefined();
    const hostDir = mount!.slice(0, -':/artifacts:ro'.length);
    expect(await readFile(join(hostDir, 'scripts/report.py'), 'utf8')).toBe('print("report")\n');
  });

  it('adds no mount when the workflow carries no files', async () => {
    await plugin.initialize(buildContext());
    mockCliSuccess();

    await plugin.run(noopEmit);

    const dockerArgs = spawnMock.mock.calls[0][1] as string[];
    expect(dockerArgs.some((arg) => arg.includes(':/artifacts'))).toBe(false);
  });
});

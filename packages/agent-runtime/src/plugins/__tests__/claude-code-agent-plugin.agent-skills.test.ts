/**
 * An agent's Skills reaching a Claude Code container (ADR-0025 decision 6): the
 * materialized plugin folder is mounted read-only at `/plugin` and handed to
 * the CLI as `--plugin-dir`, with no skill or skillsDir on the step.
 */
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { Skill } from '@mediforce/platform-core';
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

const skillMd = '---\nname: sdtm-mapping\ndescription: Map raw data to SDTM\n---\n# SDTM mapping\n';

function heldSkill(): Skill {
  return {
    namespace: 'acme',
    id: 'sdtm-mapping',
    name: 'sdtm-mapping',
    description: 'Map raw data to SDTM',
    visibility: 'private',
    contentHash: randomUUID(),
    files: [{ path: 'SKILL.md', contents: skillMd }],
    createdAt: '2026-10-06T00:00:00.000Z',
    updatedAt: '2026-10-06T00:00:00.000Z',
  };
}

function buildContext(agentSkills: Skill[] | undefined): WorkflowAgentContext {
  const step = {
    id: 'map',
    name: 'Map to SDTM',
    type: 'creation' as const,
    executor: 'agent' as const,
    plugin: 'claude-code-agent',
    agentId: 'mapper',
    agent: { prompt: 'Map the raw data to SDTM.', image: 'mediforce-agent:latest' },
  };
  return {
    stepId: 'map',
    processInstanceId: `pi-${Math.random().toString(36).slice(2, 8)}`,
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput: {},
    autonomyLevel: 'L2',
    workflowDefinition: buildWorkflowDefinition({
      name: 'sdtm-mapping',
      version: 1,
      namespace: 'acme',
      steps: [step],
      transitions: [],
    }),
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    ...(agentSkills === undefined ? {} : { agentSkills }),
  };
}

const noopEmit: EmitFn = async (_event: EmitPayload) => undefined;

describe('ClaudeCodeAgentPlugin — agent skills', () => {
  let plugin: ClaudeCodeAgentPlugin;

  beforeEach(() => {
    plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    spawnMock.mockReset();
  });

  it('mounts the agent\'s skills at /plugin, read-only, and passes --plugin-dir', async () => {
    await plugin.initialize(buildContext([heldSkill()]));
    mockCliSuccess();

    await plugin.run(noopEmit);

    const dockerArgs = spawnMock.mock.calls[0][1] as string[];
    const mount = dockerArgs.find((arg) => arg.endsWith(':/plugin:ro'));
    expect(mount, 'the plugin folder is mounted read-only').toBeDefined();
    const hostDir = mount!.slice(0, -':/plugin:ro'.length);
    expect(await readFile(join(hostDir, 'skills', 'sdtm-mapping', 'SKILL.md'), 'utf8')).toBe(skillMd);
    expect(dockerArgs.join(' ')).toContain('--plugin-dir /plugin');
  });

  it('adds no plugin mount for an agent that holds no skills', async () => {
    await plugin.initialize(buildContext([]));
    mockCliSuccess();

    await plugin.run(noopEmit);

    const dockerArgs = spawnMock.mock.calls[0][1] as string[];
    expect(dockerArgs.some((arg) => arg.includes(':/plugin'))).toBe(false);
    expect(dockerArgs.join(' ')).not.toContain('--plugin-dir');
  });
});

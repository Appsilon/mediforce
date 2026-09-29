/**
 * The Agent Trajectory (ADR-0023 D8) is recorded from the same entries the
 * step's activity log gets, as the container's stdout arrives.
 */
import { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import type { AgentTrajectoryEntry } from '@mediforce/platform-core';
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

const TOOL_CALL_LINE = JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'dm.csv' } }] },
});
const RESULT_LINE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  result: JSON.stringify({ summary: 'done' }),
});

function mockCliStdout(lines: string[]): void {
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
      for (const line of lines) (child.stdout as Readable).push(`${line}\n`);
      (child.stdout as Readable).push(null);
      (child.stderr as Readable).push(null);
      child.emit('close', 0, null);
    }, 10);
    return child;
  });
}

function buildContext(record: (entries: readonly AgentTrajectoryEntry[]) => void): WorkflowAgentContext {
  const step = {
    id: 'interpret',
    name: 'Interpret validation',
    type: 'creation' as const,
    executor: 'agent' as const,
    plugin: 'claude-code-agent',
    agent: { prompt: 'Interpret the validation report', image: 'mediforce-landing-zone:latest' },
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
    }),
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    trajectory: { record },
  };
}

const noopEmit: EmitFn = async (_event: EmitPayload) => undefined;

describe('ClaudeCodeAgentPlugin — Agent Trajectory', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('records each stdout line as the entries the activity log gets', async () => {
    const plugin = new ClaudeCodeAgentPlugin({ workspaceManager: createFakeWorkspaceManager() });
    const recorded: AgentTrajectoryEntry[] = [];
    await plugin.initialize(buildContext((entries) => recorded.push(...entries)));
    mockCliStdout([TOOL_CALL_LINE, RESULT_LINE]);

    await plugin.run(noopEmit);

    expect(recorded).toEqual([
      expect.objectContaining({ type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: 'dm.csv' } }),
      expect.objectContaining({ type: 'result', subtype: 'success' }),
    ]);
  });
});

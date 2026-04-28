/**
 * End-to-end integration of WorkspaceManager with real Docker.
 *
 * Subject under test: the full workspace lifecycle — bare repo → worktree →
 * container bind-mount at `/workspace` → host-side commit with the ◆/✓/✗
 * message format → branch history on the bare repo.
 *
 * ScriptContainerPlugin is used as the test harness because it's the simplest
 * plugin that exercises the full `docker run` path. The assertions are about
 * the workspace contract (on-disk files, commits, commit messages), not about
 * the plugin itself.
 *
 * This is the layer that hid the script-container workspace bug: every other
 * test stubbed out either Docker, git, or the plugin wiring. Requires a Docker
 * daemon. Skipped when one isn't reachable.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type {
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';
import { ScriptContainerPlugin } from '../../plugins/script-container-plugin.js';
import type {
  EmitFn,
  EmitPayload,
  WorkflowAgentContext,
} from '../../interfaces/agent-plugin.js';

function dockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const TEST_IMAGE = 'alpine:3.19';

function buildScriptContext(overrides: {
  wdName?: string;
  stepId?: string;
  inlineScript: string;
}): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: overrides.stepId ?? 'run-script',
    name: 'Run script',
    type: 'creation',
    executor: 'script',
    plugin: 'script-container',
    agent: {
      runtime: 'bash',
      image: TEST_IMAGE,
      inlineScript: overrides.inlineScript,
    },
  };

  const workflowDefinition: WorkflowDefinition = {
    name: overrides.wdName ?? `wd-script-${Math.random().toString(36).slice(2, 8)}`,
    namespace: '_default',
    version: 1,
    steps: [step],
    transitions: [],
    triggers: [{ type: 'manual', name: 'start' }],
    workspace: {},
  };

  return {
    stepId: step.id,
    processInstanceId: `pi-${Date.now().toString()}-${Math.random().toString(36).slice(2, 6)}`,
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L4',
    workflowDefinition,
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  };
}

function emitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => { events.push(event); });
  return { emit, events };
}

describe.skipIf(!dockerAvailable())('WorkspaceManager + Docker end-to-end', () => {
  let dataDir: string;
  const originalDataDir = process.env.MEDIFORCE_DATA_DIR;

  beforeAll(() => {
    try {
      execSync(`docker image inspect ${TEST_IMAGE}`, { stdio: 'pipe' });
    } catch {
      execSync(`docker pull ${TEST_IMAGE}`, { stdio: 'pipe' });
    }
  });

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'script-integ-'));
    process.env.MEDIFORCE_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    if (originalDataDir === undefined) delete process.env.MEDIFORCE_DATA_DIR;
    else process.env.MEDIFORCE_DATA_DIR = originalDataDir;
  });

  it('writes files to /workspace and the host commits them on the run branch', async () => {
    const context = buildScriptContext({
      inlineScript: [
        '#!/bin/sh',
        'set -eu',
        'mkdir -p /workspace/data',
        "echo 'ok' > /workspace/data/note.txt",
        'printf \'{"ok":true}\' > /output/result.json',
      ].join('\n'),
    });

    const plugin = new ScriptContainerPlugin();
    await plugin.initialize(context);
    await plugin.run(emitSpy().emit);

    const safeName = context.workflowDefinition.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const wtDir = join(dataDir, 'worktrees', '_default', safeName, context.processInstanceId);
    const bareRepo = join(dataDir, 'bare-repos', '_default', `${safeName}.git`);

    // File landed on the host worktree (not just inside the container).
    expect((await readFile(join(wtDir, 'data/note.txt'), 'utf-8')).trim()).toBe('ok');

    // Branch has two commits: ◇ seed + ✓/◆ step. Step with only a terminal
    // successor (the default wd has none) gets the ✓ marker.
    const subjects = execFileSync(
      'git',
      ['--git-dir', bareRepo, 'log', '--format=%s', `run/${context.processInstanceId}`],
      { encoding: 'utf-8' },
    ).trim().split('\n');
    expect(subjects).toHaveLength(2);
    expect(subjects[1]).toBe('◇ Initialize workspace repository');
    // Step is the only step in the WD → no outgoing transitions → ✓ marker.
    expect(subjects[0]).toMatch(/^✓ Run script → \+data\/note\.txt$/);

    // Trailers carry structured metadata.
    const body = execFileSync(
      'git',
      ['--git-dir', bareRepo, 'log', '-1', '--format=%B', `run/${context.processInstanceId}`],
      { encoding: 'utf-8' },
    );
    expect(body).toMatch(/Step-Id: run-script/);
    expect(body).toMatch(/Run-Id: /);
    expect(body).toMatch(/Step-Status: success/);
    expect(body).toMatch(/Agent-Plugin: script-container/);
    expect(body).toMatch(/Agent-Image: alpine:3\.19/);
  });

  it('commits a ✗ marker when the script fails so the branch is still auditable', async () => {
    const context = buildScriptContext({
      inlineScript: [
        '#!/bin/sh',
        'set -eu',
        // Write a partial artefact BEFORE the failure — we want it committed.
        'mkdir -p /workspace',
        "echo 'partial output' > /workspace/partial.txt",
        'printf \'{"ok":false}\' > /output/result.json',
        'exit 1',
      ].join('\n'),
    });

    const plugin = new ScriptContainerPlugin();
    await plugin.initialize(context);
    await expect(plugin.run(emitSpy().emit)).rejects.toThrow(/Script container failed/);

    const safeName = context.workflowDefinition.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const bareRepo = join(dataDir, 'bare-repos', '_default', `${safeName}.git`);

    const subjects = execFileSync(
      'git',
      ['--git-dir', bareRepo, 'log', '--format=%s', `run/${context.processInstanceId}`],
      { encoding: 'utf-8' },
    ).trim().split('\n');
    // seed + failed step commit
    expect(subjects).toHaveLength(2);
    expect(subjects[0]).toMatch(/^✗ Run script — failed: /);

    const body = execFileSync(
      'git',
      ['--git-dir', bareRepo, 'log', '-1', '--format=%B', `run/${context.processInstanceId}`],
      { encoding: 'utf-8' },
    );
    expect(body).toMatch(/Step-Status: failed/);
    // The partial artefact made it in — so an operator can diagnose.
    expect(body).toMatch(/\+partial\.txt/);
  });

  it('step 2 of the same run reattaches to the worktree and sees step 1 files', async () => {
    const ctx1 = buildScriptContext({
      stepId: 'step-1',
      inlineScript: [
        '#!/bin/sh',
        'set -eu',
        "echo 'first' > /workspace/marker.txt",
        'printf \'{"ok":true}\' > /output/result.json',
      ].join('\n'),
    });
    const plugin1 = new ScriptContainerPlugin();
    await plugin1.initialize(ctx1);
    await plugin1.run(emitSpy().emit);

    const ctx2: WorkflowAgentContext = {
      ...ctx1,
      stepId: 'step-2',
      step: {
        ...ctx1.step,
        id: 'step-2',
        agent: {
          ...ctx1.step.agent,
          inlineScript: [
            '#!/bin/sh',
            'set -eu',
            'test -f /workspace/marker.txt',
            "cat /workspace/marker.txt > /workspace/mirror.txt",
            'printf \'{"ok":true}\' > /output/result.json',
          ].join('\n'),
        },
      },
    };
    const plugin2 = new ScriptContainerPlugin();
    await plugin2.initialize(ctx2);
    await plugin2.run(emitSpy().emit);

    const safeName = ctx1.workflowDefinition.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const wtDir = join(dataDir, 'worktrees', '_default', safeName, ctx1.processInstanceId);
    const bareRepo = join(dataDir, 'bare-repos', '_default', `${safeName}.git`);

    // Both markers on disk — proves the worktree was shared.
    expect((await readFile(join(wtDir, 'marker.txt'), 'utf-8')).trim()).toBe('first');
    expect((await readFile(join(wtDir, 'mirror.txt'), 'utf-8')).trim()).toBe('first');

    // Three commits total: seed + step 1 + step 2.
    const log = execFileSync('git', ['--git-dir', bareRepo, 'log', '--oneline', `run/${ctx1.processInstanceId}`], {
      encoding: 'utf-8',
    }).trim().split('\n');
    expect(log.length).toBe(3);
  });
});

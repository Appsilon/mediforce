/**
 * Tests for copyOutputFilesIntoWorkspace and its wiring into
 * ContainerPlugin.commitRunWorkspace. Real git via WorkspaceManager
 * against temp dirs — no network, no Docker.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile, stat, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type {
  PluginCapabilityMetadata,
  WorkflowDefinition,
  WorkflowStep,
  WorkflowWorkspace,
} from '@mediforce/platform-core';
import { WorkspaceManager, type RunWorkspaceHandle } from '../workspace-manager';
import { copyOutputFilesIntoWorkspace } from '../output-files';
import {
  ContainerPlugin,
  type CommitRunWorkspaceOptions,
  type WorkspaceManagerLike,
} from '../../plugins/container-plugin';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { GitMetadata } from '@mediforce/platform-core';

const MAX_BYTES_ENV = 'MEDIFORCE_OUTPUT_FILE_MAX_BYTES';

describe('copyOutputFilesIntoWorkspace', () => {
  let outputDir: string;
  let worktreeDir: string;
  const originalMaxBytes = process.env[MAX_BYTES_ENV];

  beforeEach(async () => {
    outputDir = await mkdtemp(join(tmpdir(), 'outfiles-output-'));
    worktreeDir = await mkdtemp(join(tmpdir(), 'outfiles-worktree-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
    if (originalMaxBytes === undefined) delete process.env[MAX_BYTES_ENV];
    else process.env[MAX_BYTES_ENV] = originalMaxBytes;
    vi.restoreAllMocks();
  });

  it('copies top-level files into .mediforce/output/<stepId>/', async () => {
    await writeFile(join(outputDir, 'report.csv'), 'a,b\n1,2\n');
    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'extract');

    const copied = await readFile(join(worktreeDir, '.mediforce', 'output', 'extract', 'report.csv'), 'utf-8');
    expect(copied).toBe('a,b\n1,2\n');
  });

  it('filters internal runtime files by name but copies presentation files', async () => {
    const internals = [
      'auth.json',
      'prompt.txt',
      'result.json',
      'git-result.json',
      'mock-result.json',
      'opencode.json',
      'input.json',
      'previous_run.json',
      'mcp-config.json',
      'script.mjs',
      'script.py',
      'script.R',
      'script.sh',
    ];
    for (const name of internals) {
      await writeFile(join(outputDir, name), '{}');
    }
    await writeFile(join(outputDir, 'presentation.md'), '# deck');
    await writeFile(join(outputDir, 'presentation.html'), '<h1>deck</h1>');
    await writeFile(join(outputDir, 'findings.json'), '{"ok":true}');

    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

    const destDir = join(worktreeDir, '.mediforce', 'output', 'step-1');
    await expect(readFile(join(destDir, 'presentation.md'), 'utf-8')).resolves.toBe('# deck');
    await expect(readFile(join(destDir, 'presentation.html'), 'utf-8')).resolves.toBe('<h1>deck</h1>');
    await expect(readFile(join(destDir, 'findings.json'), 'utf-8')).resolves.toBe('{"ok":true}');
    for (const name of internals) {
      await expect(stat(join(destDir, name))).rejects.toThrow();
    }
  });

  it('skips dotfiles at the top level', async () => {
    await writeFile(join(outputDir, '.hidden'), 'nope');
    await writeFile(join(outputDir, 'visible.txt'), 'yes');

    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

    const destDir = join(worktreeDir, '.mediforce', 'output', 'step-1');
    await expect(readFile(join(destDir, 'visible.txt'), 'utf-8')).resolves.toBe('yes');
    await expect(stat(join(destDir, '.hidden'))).rejects.toThrow();
  });

  it('copies nested directories recursively; internal-name filtering applies only at the top level', async () => {
    await mkdir(join(outputDir, 'charts', 'q1'), { recursive: true });
    await writeFile(join(outputDir, 'charts', 'q1', 'plot.svg'), '<svg/>');
    await writeFile(join(outputDir, 'charts', 'result.json'), '{"nested":true}');

    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

    const destDir = join(worktreeDir, '.mediforce', 'output', 'step-1');
    await expect(readFile(join(destDir, 'charts', 'q1', 'plot.svg'), 'utf-8')).resolves.toBe('<svg/>');
    await expect(readFile(join(destDir, 'charts', 'result.json'), 'utf-8')).resolves.toBe('{"nested":true}');
  });

  it('skips files over the MEDIFORCE_OUTPUT_FILE_MAX_BYTES cap with a warning', async () => {
    process.env[MAX_BYTES_ENV] = '8';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(join(outputDir, 'huge.bin'), 'x'.repeat(32));
    await writeFile(join(outputDir, 'tiny.txt'), 'ok');

    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

    const destDir = join(worktreeDir, '.mediforce', 'output', 'step-1');
    await expect(readFile(join(destDir, 'tiny.txt'), 'utf-8')).resolves.toBe('ok');
    await expect(stat(join(destDir, 'huge.bin'))).rejects.toThrow();
    const warned = warnSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(warned).toContain('huge.bin');
    expect(warned).toContain('32');
    expect(warned).toContain('8');
  });

  it('never follows symlinks — an agent-written link to a host path must not be copied', async () => {
    const hostDir = await mkdtemp(join(tmpdir(), 'outfiles-host-'));
    try {
      await writeFile(join(hostDir, 'secret.txt'), 'host-sentinel-do-not-leak');
      await mkdir(join(hostDir, 'secrets-dir'));
      await writeFile(join(hostDir, 'secrets-dir', 'inner.txt'), 'host-sentinel-dir');
      await symlink(join(hostDir, 'secret.txt'), join(outputDir, 'leak'));
      await symlink(join(hostDir, 'secrets-dir'), join(outputDir, 'leak-dir'));
      await writeFile(join(outputDir, 'legit.txt'), 'fine');

      await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

      const destDir = join(worktreeDir, '.mediforce', 'output', 'step-1');
      await expect(readFile(join(destDir, 'legit.txt'), 'utf-8')).resolves.toBe('fine');
      await expect(stat(join(destDir, 'leak'))).rejects.toThrow();
      await expect(stat(join(destDir, 'leak-dir'))).rejects.toThrow();
    } finally {
      await rm(hostDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('does nothing when outputDir does not exist', async () => {
    await expect(
      copyOutputFilesIntoWorkspace(join(outputDir, 'missing-subdir'), worktreeDir, 'step-1'),
    ).resolves.toBeUndefined();
    await expect(stat(join(worktreeDir, '.mediforce'))).rejects.toThrow();
  });

  it('does not create an empty .mediforce/output/<stepId>/ dir when nothing is copyable', async () => {
    await writeFile(join(outputDir, 'result.json'), '{}');
    await writeFile(join(outputDir, '.dotfile'), 'skip');

    await copyOutputFilesIntoWorkspace(outputDir, worktreeDir, 'step-1');

    await expect(stat(join(worktreeDir, '.mediforce'))).rejects.toThrow();
  });
});

class TestContainerPlugin extends ContainerPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'test-container',
    description: 'test double for commitRunWorkspace',
    inputDescription: 'none',
    outputDescription: 'none',
    roles: ['executor'],
  };

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    this.context = context;
  }

  async run(_emit: EmitFn): Promise<void> {}

  attachWorkspace(handle: RunWorkspaceHandle, manager: WorkspaceManagerLike): void {
    this.runWorkspaceHandle = handle;
    this.workspaceManager = manager;
  }

  commit(outputDir: string, opts?: CommitRunWorkspaceOptions): Promise<GitMetadata | null> {
    return this.commitRunWorkspace(outputDir, opts);
  }
}

function buildWorkflowContext(stepId: string): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: stepId,
    name: 'Test Step',
    type: 'creation',
    executor: 'agent',
    plugin: 'test-container',
    agent: { skill: 'noop' },
  };
  const workflowDefinition: WorkflowDefinition = {
    name: `wd-outfiles-${Math.random().toString(36).slice(2, 8)}`,
    namespace: '_default',
    version: 1,
    visibility: 'private',
    steps: [step],
    transitions: [],
    triggers: [{ type: 'manual', name: 'start' }],
    workspace: {},
  };
  return {
    stepId,
    processInstanceId: `pi-${Date.now().toString()}-${Math.random().toString(36).slice(2, 6)}`,
    runNamespace: 'test',
    definitionVersion: 'v1',
    stepInput: {},
    autonomyLevel: 'L4',
    workflowDefinition,
    step,
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
  };
}

describe('ContainerPlugin.commitRunWorkspace output-file capture', () => {
  let dataDir: string;
  let outputDir: string;
  let manager: WorkspaceManager;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'outfiles-commit-data-'));
    outputDir = await mkdtemp(join(tmpdir(), 'outfiles-commit-output-'));
    manager = new WorkspaceManager({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    await rm(outputDir, { recursive: true, force: true }).catch(() => {});
  });

  async function setupPlugin(
    stepId: string,
  ): Promise<{ plugin: TestContainerPlugin; handle: RunWorkspaceHandle; context: WorkflowAgentContext }> {
    const context = buildWorkflowContext(stepId);
    const plugin = new TestContainerPlugin();
    await plugin.initialize(context);
    const handle = await manager.createRunWorkspace(
      {
        name: context.workflowDefinition.name,
        namespace: context.workflowDefinition.namespace,
        workspace: {} as WorkflowWorkspace,
      },
      context.processInstanceId,
    );
    plugin.attachWorkspace(handle, manager);
    return { plugin, handle, context };
  }

  it('copies output files into the workspace so the step commit captures them (success)', async () => {
    const { plugin, handle } = await setupPlugin('extract');
    await writeFile(join(outputDir, 'report.csv'), 'a,b\n');
    await writeFile(join(outputDir, 'result.json'), '{"internal":true}');

    const metadata = await plugin.commit(outputDir);

    expect(metadata).not.toBeNull();
    const committedFiles = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', metadata!.commitSha],
      { cwd: handle.path, encoding: 'utf-8' },
    )
      .trim()
      .split('\n');
    expect(committedFiles).toContain('.mediforce/output/extract/report.csv');
    expect(committedFiles).not.toContain('.mediforce/output/extract/result.json');

    // git-result.json is still written into outputDir post-commit (existing contract)
    const gitResult = JSON.parse(await readFile(join(outputDir, 'git-result.json'), 'utf-8')) as GitMetadata;
    expect(gitResult.commitSha).toBe(metadata!.commitSha);
  });

  it('copies output files on failed-step commits too', async () => {
    const { plugin, handle } = await setupPlugin('doomed');
    await writeFile(join(outputDir, 'partial.log'), 'got this far');

    const metadata = await plugin.commit(outputDir, { status: 'failed', error: 'boom' });

    expect(metadata).not.toBeNull();
    const committedFiles = execFileSync(
      'git',
      ['diff-tree', '--no-commit-id', '--name-only', '-r', metadata!.commitSha],
      { cwd: handle.path, encoding: 'utf-8' },
    )
      .trim()
      .split('\n');
    expect(committedFiles).toContain('.mediforce/output/doomed/partial.log');

    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: handle.path, encoding: 'utf-8' }).trim();
    expect(subject).toContain('✗');
  });
});

/**
 * Tests for the step output folder (ADR-0030) — emptied when a step starts,
 * committed with the step minus the seeded inputs and oversized files — and
 * its wiring into ContainerPlugin. Real git via WorkspaceManager against temp
 * dirs — no network, no Docker.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PluginCapabilityMetadata, WorkflowDefinition, WorkflowStep, WorkflowWorkspace } from '@mediforce/platform-core';
import { WorkspaceManager, type RunWorkspaceHandle } from '../workspace-manager';
import { prepareStepOutputDirForCommit, resetStepOutputDir } from '../output-files';
import { ContainerPlugin, type CommitRunWorkspaceOptions, type WorkspaceManagerLike } from '../../plugins/container-plugin';
import type { AgentContext, WorkflowAgentContext, EmitFn } from '../../interfaces/step-executor-plugin';
import type { GitMetadata } from '@mediforce/platform-core';

const MAX_BYTES_ENV = 'MEDIFORCE_OUTPUT_FILE_MAX_BYTES';

describe('step output folder', () => {
  let worktreeDir: string;
  const originalMaxBytes = process.env[MAX_BYTES_ENV];

  beforeEach(async () => {
    worktreeDir = await mkdtemp(join(tmpdir(), 'outfiles-worktree-'));
  });

  afterEach(async () => {
    await rm(worktreeDir, { recursive: true, force: true }).catch(() => {});
    if (originalMaxBytes === undefined) delete process.env[MAX_BYTES_ENV];
    else process.env[MAX_BYTES_ENV] = originalMaxBytes;
    vi.restoreAllMocks();
  });

  it('is .mediforce/output/<stepId>/ in the worktree, emptied of an earlier execution\'s files', async () => {
    const first = await resetStepOutputDir(worktreeDir, 'extract');
    await writeFile(join(first, 'result.json'), '{"stale":true}');
    await mkdir(join(first, 'charts'));
    await writeFile(join(first, 'charts', 'plot.svg'), '<svg/>');

    const second = await resetStepOutputDir(worktreeDir, 'extract');

    expect(second).toBe(join(worktreeDir, '.mediforce', 'output', 'extract'));
    expect(await readdir(second)).toEqual([]);
  });

  it('removes the seeded inputs before the commit, keeping result.json and the Output Files', async () => {
    const dir = await resetStepOutputDir(worktreeDir, 'extract');
    for (const name of ['input.json', 'previous_run.json', 'result.json', 'report.csv', 'presentation.md']) {
      await writeFile(join(dir, name), 'x');
    }

    await prepareStepOutputDirForCommit(dir);

    expect((await readdir(dir)).sort()).toEqual(['presentation.md', 'report.csv', 'result.json']);
  });

  it('removes files over the MEDIFORCE_OUTPUT_FILE_MAX_BYTES cap, nested ones too, with a warning', async () => {
    process.env[MAX_BYTES_ENV] = '10';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dir = await resetStepOutputDir(worktreeDir, 'extract');
    await writeFile(join(dir, 'small.txt'), 'tiny');
    await mkdir(join(dir, 'nested'));
    await writeFile(join(dir, 'nested', 'big.bin'), 'x'.repeat(50));

    await prepareStepOutputDirForCommit(dir);

    await expect(stat(join(dir, 'small.txt'))).resolves.toBeDefined();
    await expect(stat(join(dir, 'nested', 'big.bin'))).rejects.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('nested/big.bin'));
  });

  it('does nothing when the folder does not exist', async () => {
    await expect(prepareStepOutputDirForCommit(join(worktreeDir, 'missing'))).resolves.toBeUndefined();
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

  startStep(): Promise<string> {
    return this.resetStepOutputDir();
  }

  commit(opts?: CommitRunWorkspaceOptions): Promise<GitMetadata | null> {
    return this.commitRunWorkspace(opts);
  }
}

function buildWorkflowContext(stepId: string): WorkflowAgentContext {
  const step: WorkflowStep = {
    id: stepId,
    name: 'Test Step',
    type: 'creation',
    executor: 'agent',
    plugin: 'test-container',
    agent: { prompt: 'noop' },
  };
  const workflowDefinition: WorkflowDefinition = {
    name: `wd-outfiles-${Math.random().toString(36).slice(2, 8)}`,
    namespace: '_default',
    version: 1,
    visibility: 'private',
    steps: [step],
    transitions: [],
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

describe('ContainerPlugin.commitRunWorkspace with the step output folder', () => {
  let dataDir: string;
  let manager: WorkspaceManager;
  const originalMaxBytes = process.env[MAX_BYTES_ENV];

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'outfiles-commit-data-'));
    manager = new WorkspaceManager({ dataDir });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
    if (originalMaxBytes === undefined) delete process.env[MAX_BYTES_ENV];
    else process.env[MAX_BYTES_ENV] = originalMaxBytes;
    vi.restoreAllMocks();
  });

  async function setupPlugin(stepId: string): Promise<{ plugin: TestContainerPlugin; handle: RunWorkspaceHandle }> {
    const context = buildWorkflowContext(stepId);
    const plugin = new TestContainerPlugin();
    await plugin.initialize(context);
    const handle = await manager.createRunWorkspace(
      { name: context.workflowDefinition.name, namespace: context.workflowDefinition.namespace, workspace: {} as WorkflowWorkspace },
      context.processInstanceId,
    );
    plugin.attachWorkspace(handle, manager);
    return { plugin, handle };
  }

  function committedFiles(handle: RunWorkspaceHandle, commitSha: string): string[] {
    return execFileSync(
      'git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commitSha],
      { cwd: handle.path, encoding: 'utf-8' },
    ).trim().split('\n');
  }

  it('commits the folder as written — result.json and Output Files, never the seeded input', async () => {
    const { plugin, handle } = await setupPlugin('extract');
    const dir = await plugin.startStep();
    await writeFile(join(dir, 'input.json'), '{"seeded":true}');
    await writeFile(join(dir, 'result.json'), '{"grade":3}');
    await writeFile(join(dir, 'report.csv'), 'a,b\n');

    const metadata = await plugin.commit();

    expect(committedFiles(handle, metadata!.commitSha).sort()).toEqual([
      '.mediforce/output/extract/report.csv',
      '.mediforce/output/extract/result.json',
    ]);
    expect(metadata!.changedFiles).toContain('.mediforce/output/extract/report.csv');
  });

  it('commits the folder on failed-step commits too', async () => {
    const { plugin, handle } = await setupPlugin('doomed');
    const dir = await plugin.startStep();
    await writeFile(join(dir, 'partial.log'), 'got this far');

    const metadata = await plugin.commit({ status: 'failed', error: 'boom' });

    expect(committedFiles(handle, metadata!.commitSha)).toContain('.mediforce/output/doomed/partial.log');
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: handle.path, encoding: 'utf-8' }).trim();
    expect(subject).toContain('✗');
  });

  it('never commits a file over the size cap', async () => {
    process.env[MAX_BYTES_ENV] = '10';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { plugin, handle } = await setupPlugin('export');
    const dir = await plugin.startStep();
    await writeFile(join(dir, 'result.json'), '{}');
    await writeFile(join(dir, 'dump.bin'), 'x'.repeat(50));

    const metadata = await plugin.commit();

    expect(committedFiles(handle, metadata!.commitSha)).toEqual(['.mediforce/output/export/result.json']);
  });

  it('drops an earlier execution\'s files from the branch when the step runs again, keeping them in history', async () => {
    const { plugin, handle } = await setupPlugin('revise');
    const firstDir = await plugin.startStep();
    await writeFile(join(firstDir, 'draft-1.md'), 'first');
    await plugin.commit();

    const secondDir = await plugin.startStep();
    await writeFile(join(secondDir, 'draft-2.md'), 'second');
    await plugin.commit();

    expect((await manager.listOutputFiles(handle)).map((file) => file.name)).toEqual(['draft-2.md']);
    const history = execFileSync('git', ['log', '--name-only', '--format='], { cwd: handle.path, encoding: 'utf-8' });
    expect(history).toContain('.mediforce/output/revise/draft-1.md');
  });
});

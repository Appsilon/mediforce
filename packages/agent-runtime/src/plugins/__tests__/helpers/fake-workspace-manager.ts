import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkspaceManagerLike } from '../../container-plugin';
import type { RunWorkspaceHandle, StepFiles } from '../../../workspace/workspace-manager';
import type { OutputFileEntry } from '../../../workspace/workspace-reader';
import { vi } from 'vitest';

// One parent directory per test process, removed when the process exits.
const fakeWorkspacesRoot = mkdtempSync(join(tmpdir(), 'mediforce-fake-workspaces-'));
process.once('exit', () => rmSync(fakeWorkspacesRoot, { recursive: true, force: true }));

export interface FakeWorkspaceManagerOptions {
  handle?: Partial<RunWorkspaceHandle>;
  stepFiles?: StepFiles[];
  outputFiles?: OutputFileEntry[];
}

export function createFakeWorkspaceManager(
  options: FakeWorkspaceManagerOptions = {},
): WorkspaceManagerLike {
  const handle: RunWorkspaceHandle = {
    // A real, per-manager directory: the plugin empties and writes the step's
    // output folder inside it.
    path: mkdtempSync(join(fakeWorkspacesRoot, 'workspace-')),
    branch: 'run/fake-run',
    startCommit: 'fake-start-commit',
    bareRepoPath: '/tmp/mediforce-fake-bare.git',
    remoteUrl: null,
    ...options.handle,
  };

  return {
    createRunWorkspace: vi.fn(async (_workflow, runId) => ({
      ...handle,
      branch: `run/${runId}`,
    })),
    commitStep: vi.fn(async () => ({
      commitSha: 'fake-commit-sha',
      changedFiles: [],
      isEmpty: true,
    })),
    listStepFiles: vi.fn(async () => options.stepFiles ?? []),
    listOutputFiles: vi.fn(async () => options.outputFiles ?? []),
  };
}

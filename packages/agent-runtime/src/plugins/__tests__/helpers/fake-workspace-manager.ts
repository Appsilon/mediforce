import type { WorkspaceManagerLike } from '../../container-plugin.js';
import type { RunWorkspaceHandle } from '../../../workspace/workspace-manager.js';
import { vi } from 'vitest';

export interface FakeWorkspaceManagerOptions {
  handle?: Partial<RunWorkspaceHandle>;
}

export function createFakeWorkspaceManager(
  options: FakeWorkspaceManagerOptions = {},
): WorkspaceManagerLike {
  const handle: RunWorkspaceHandle = {
    path: '/tmp/mediforce-fake-workspace',
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
  };
}

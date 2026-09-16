import { describe, it, expect } from 'vitest';
import type { WorkflowStep } from '@mediforce/platform-core';
import { repoBackedSteps, repoBackedFiles, isAlreadyCarried, takeOverFiles } from '../repo-backed-steps';

const COMMIT = '9f2c1d4a7b30e58c6a1f42db9e7c05a8b3d16f27';

function scriptStep(overrides: Record<string, unknown>): WorkflowStep {
  return {
    id: 'build', name: 'Build', type: 'creation', executor: 'script',
    script: { inlineScript: 'echo hi\n', runtime: 'bash', ...overrides },
  } as unknown as WorkflowStep;
}

describe('repoBackedSteps', () => {
  it('finds a script step that builds a Dockerfile from a repo', () => {
    expect(repoBackedSteps([scriptStep({ repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' })])).toEqual([
      { stepId: 'build', stepName: 'Build', repo: 'org/repo', commit: COMMIT, paths: ['Dockerfile'] },
    ]);
  });

  it('ignores a step that carries no repository', () => {
    expect(repoBackedSteps([scriptStep({ image: 'mediforce-agent:tealflow' })])).toEqual([]);
  });

  it('ignores a repo step that names no files, since there is nothing to read', () => {
    expect(repoBackedSteps([scriptStep({ repo: 'org/repo', commit: COMMIT })])).toEqual([]);
  });
});

describe('repoBackedFiles', () => {
  const shared = { repo: 'org/repo', commit: COMMIT, dockerfile: 'container/Dockerfile' };

  it('lists a file shared by several steps once, naming them all', () => {
    const steps = [
      { ...scriptStep(shared), id: 'build', name: 'Build' },
      { ...scriptStep(shared), id: 'test', name: 'Test' },
      { ...scriptStep(shared), id: 'deploy', name: 'Deploy' },
    ] as WorkflowStep[];
    expect(repoBackedFiles(steps)).toEqual([{
      repo: 'org/repo',
      commit: COMMIT,
      path: 'container/Dockerfile',
      stepId: 'build',
      stepNames: ['Build', 'Test', 'Deploy'],
    }]);
  });

  it('keeps the same path separate when it comes from a different commit', () => {
    const other = '0123456789abcdef0123456789abcdef01234567';
    const steps = [
      { ...scriptStep(shared), id: 'build', name: 'Build' },
      { ...scriptStep({ ...shared, commit: other }), id: 'test', name: 'Test' },
    ] as WorkflowStep[];
    expect(repoBackedFiles(steps)).toHaveLength(2);
  });
});

describe('isAlreadyCarried', () => {
  it('is true once the workflow carries that path', () => {
    expect(isAlreadyCarried([{ path: 'Dockerfile', contents: 'FROM r' }], 'Dockerfile')).toBe(true);
    expect(isAlreadyCarried([], 'Dockerfile')).toBe(false);
  });
});

describe('takeOverFiles', () => {
  it('adds files the workflow did not carry', () => {
    expect(takeOverFiles([], [{ path: 'Dockerfile', contents: 'FROM r' }]))
      .toEqual([{ path: 'Dockerfile', contents: 'FROM r' }]);
  });

  it('refreshes a path already carried rather than duplicating it', () => {
    const existing = [{ path: 'Dockerfile', contents: 'stale' }, { path: 'run.sh', contents: 'keep' }];
    expect(takeOverFiles(existing, [{ path: 'Dockerfile', contents: 'fresh' }])).toEqual([
      { path: 'Dockerfile', contents: 'fresh' },
      { path: 'run.sh', contents: 'keep' },
    ]);
  });
});

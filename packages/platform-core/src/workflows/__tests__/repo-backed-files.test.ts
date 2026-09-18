import { describe, it, expect } from 'vitest';
import type { WorkflowStep } from '../../schemas/workflow-definition';
import { repoBackedPaths, allowedRepoHosts, repoHost } from '../repo-backed-files';

const COMMIT = '9f2c1d4a7b30e58c6a1f42db9e7c05a8b3d16f27';

describe('repoBackedPaths', () => {
  it('names the step dockerfile', () => {
    const step = {
      id: 'build', name: 'Build', type: 'creation', executor: 'script',
      script: { inlineScript: 'x', runtime: 'bash', repo: 'org/repo', commit: COMMIT, dockerfile: 'Dockerfile' },
    } as unknown as WorkflowStep;
    expect(repoBackedPaths(step)).toEqual(['Dockerfile']);
  });

  it('names the SKILL.md an agent step reads', () => {
    const step = {
      id: 'draft', name: 'Draft', type: 'creation', executor: 'agent',
      agent: { repo: 'org/skills', commit: COMMIT, skillsDir: 'skills', skill: 'validator' },
    } as unknown as WorkflowStep;
    expect(repoBackedPaths(step)).toEqual(['skills/validator/SKILL.md']);
  });

  it('names nothing when the step points at no file', () => {
    const step = {
      id: 'build', name: 'Build', type: 'creation', executor: 'script',
      script: { inlineScript: 'x', runtime: 'bash', repo: 'org/repo', commit: COMMIT },
    } as unknown as WorkflowStep;
    expect(repoBackedPaths(step)).toEqual([]);
  });
});

describe('repoHost', () => {
  it.each([
    ['org/repo', 'github.com'],
    ['https://github.com/org/repo', 'github.com'],
    ['git@gitlab.com:org/repo.git', 'gitlab.com'],
    ['https://evil.example/org/repo', 'evil.example'],
  ])('reads the host of %s', (ref, host) => {
    expect(repoHost(ref)).toBe(host);
  });

  it('has no host for something that is not a repository reference', () => {
    expect(repoHost('not a repo')).toBeNull();
  });
});

describe('allowedRepoHosts', () => {
  it('covers the public forges by default', () => {
    expect(allowedRepoHosts()).toContain('github.com');
    expect(allowedRepoHosts()).not.toContain('git.internal');
  });

  it('takes extra hosts from configuration', () => {
    expect(allowedRepoHosts('git.internal, Git.Other ')).toEqual(
      expect.arrayContaining(['git.internal', 'git.other']),
    );
  });
});

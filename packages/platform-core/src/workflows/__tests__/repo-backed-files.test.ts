import { describe, it, expect } from 'vitest';
import { allowedRepoHosts, repoHost } from '../repo-backed-files';


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

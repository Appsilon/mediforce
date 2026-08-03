import { describe, it, expect } from 'vitest';
import { redactRepoCredentials, resolveRepoCloneTargets } from '../repo-url';

describe('resolveRepoCloneTargets', () => {
  it('[DATA] clones a git@ ref over SSH as given, never converting to HTTPS', () => {
    expect(resolveRepoCloneTargets('git@github.com:Appsilon/mediforce.git')).toEqual([
      { cloneUrl: 'git@github.com:Appsilon/mediforce.git', useSsh: true },
    ]);
  });

  it('[DATA] clones a local path directly, no SSH', () => {
    expect(resolveRepoCloneTargets('/path/to/bare.git')).toEqual([
      { cloneUrl: '/path/to/bare.git', useSsh: false },
    ]);
  });

  it('[DATA] keeps an absolute local path local when a token is provided', () => {
    expect(resolveRepoCloneTargets('/path/to/bare.git', 'TOK')).toEqual([
      { cloneUrl: '/path/to/bare.git', useSsh: false },
    ]);
  });

  it('[DATA] keeps a relative local path local when a token is provided', () => {
    expect(resolveRepoCloneTargets('./path/to/bare.git', 'TOK')).toEqual([
      { cloneUrl: './path/to/bare.git', useSsh: false },
    ]);
  });

  it('[DATA] redacts tokens and URL credentials from clone errors', () => {
    expect(
      redactRepoCredentials(
        'fatal: https://x-access-token:SECRET@github.com/owner/repo.git',
        'SECRET',
      ),
    ).toBe('fatal: https://[REDACTED]@github.com/owner/repo.git');
  });

  it('[DATA] tries anonymous HTTPS first for an owner/repo shorthand, then the deploy key', () => {
    expect(resolveRepoCloneTargets('Appsilon/mediforce')).toEqual([
      { cloneUrl: 'https://github.com/Appsilon/mediforce', useSsh: false },
      { cloneUrl: 'git@github.com:Appsilon/mediforce.git', useSsh: true },
    ]);
  });

  it('[DATA] keeps an SSH fallback for an https GitHub ref so a private repo still reaches its deploy key', () => {
    expect(resolveRepoCloneTargets('https://github.com/Appsilon/mediforce')).toEqual([
      { cloneUrl: 'https://github.com/Appsilon/mediforce', useSsh: false },
      { cloneUrl: 'git@github.com:Appsilon/mediforce.git', useSsh: true },
    ]);
  });

  it('[DATA] offers no SSH fallback for a non-GitHub https ref, which has no SSH form to derive', () => {
    expect(resolveRepoCloneTargets('https://gitlab.com/org/repo')).toEqual([
      { cloneUrl: 'https://gitlab.com/org/repo', useSsh: false },
    ]);
  });

  it('[DATA] uses authenticated HTTPS (PAT) when a token is provided, even for an https ref', () => {
    expect(resolveRepoCloneTargets('https://github.com/Appsilon/mediforce', 'TOK')).toEqual([
      { cloneUrl: 'https://x-access-token:TOK@github.com/Appsilon/mediforce.git', useSsh: false },
    ]);
  });

  it('[DATA] a token forces HTTPS even when the ref is given in SSH form', () => {
    expect(resolveRepoCloneTargets('git@github.com:Appsilon/mediforce.git', 'TOK')).toEqual([
      { cloneUrl: 'https://x-access-token:TOK@github.com/Appsilon/mediforce.git', useSsh: false },
    ]);
  });

  it('[DATA] keeps SSH for a non-GitHub SSH ref, where the token cannot be put into an HTTPS URL', () => {
    expect(resolveRepoCloneTargets('git@gitlab.com:org/repo.git', 'TOK')).toEqual([
      { cloneUrl: 'git@gitlab.com:org/repo.git', useSsh: true },
    ]);
  });
});

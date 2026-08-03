import { describe, it, expect } from 'vitest';
import { formatExitInfo, deriveBuildTag } from '../container-plugin';

describe('formatExitInfo', () => {
  it('[DATA] reports the exit code when the process exited normally', () => {
    expect(formatExitInfo({ exitCode: 1, signal: null })).toBe('exit code 1');
    expect(formatExitInfo({ exitCode: 0, signal: null })).toBe('exit code 0');
  });

  it('[DATA] reports the signal when the process was killed', () => {
    expect(formatExitInfo({ exitCode: null, signal: 'SIGKILL' })).toBe('killed by SIGKILL');
  });

  it('[DATA] annotates SIGTERM as a likely timeout when the limit is known', () => {
    expect(formatExitInfo({ exitCode: null, signal: 'SIGTERM' }, 10)).toBe(
      'killed by SIGTERM (likely timeout — 10 min limit)',
    );
  });

  it('[DATA] omits the timeout hint for SIGTERM when no limit is provided', () => {
    expect(formatExitInfo({ exitCode: null, signal: 'SIGTERM' })).toBe('killed by SIGTERM');
  });

  it('[DATA] does not annotate non-SIGTERM signals with a timeout hint', () => {
    expect(formatExitInfo({ exitCode: null, signal: 'SIGKILL' }, 10)).toBe('killed by SIGKILL');
  });
});

describe('deriveBuildTag', () => {
  it('[DATA] returns a mediforce-built: tag with a 12-char hex suffix', () => {
    const tag = deriveBuildTag('git@github.com:org/repo.git', 'abc1234');
    expect(tag).toMatch(/^mediforce-built:[0-9a-f]{12}$/);
  });

  it('[DATA] is deterministic — same inputs produce the same tag', () => {
    const a = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'Dockerfile');
    const b = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'Dockerfile');
    expect(a).toBe(b);
  });

  it('[DATA] different repo produces a different tag', () => {
    const a = deriveBuildTag('git@github.com:org/repo-a.git', 'abc1234');
    const b = deriveBuildTag('git@github.com:org/repo-b.git', 'abc1234');
    expect(a).not.toBe(b);
  });

  it('[DATA] different commit produces a different tag', () => {
    const a = deriveBuildTag('git@github.com:org/repo.git', 'abc1234');
    const b = deriveBuildTag('git@github.com:org/repo.git', 'def5678');
    expect(a).not.toBe(b);
  });

  it('[DATA] different dockerfile path produces a different tag', () => {
    const a = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'Dockerfile');
    const b = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'docker/Dockerfile.prod');
    expect(a).not.toBe(b);
  });

  it('[DATA] omitting dockerfile is equivalent to an empty dockerfile path', () => {
    const withUndefined = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', undefined);
    const withEmpty = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', '');
    expect(withUndefined).toBe(withEmpty);
  });
});

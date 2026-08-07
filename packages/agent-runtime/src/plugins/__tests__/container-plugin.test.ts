import { describe, it, expect } from 'vitest';
import { formatExitInfo, deriveBuildTag, missingExecutableHint } from '../container-plugin';

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

describe('missingExecutableHint', () => {
  // Verbatim daemon output from picking a bare alpine image for an agent step:
  // the one actionable fact — the image has no `bash` — is buried under four
  // layers of OCI runtime framing.
  const ALPINE_STDERR =
    'docker: Error response from daemon: failed to create task for container: ' +
    'failed to create shim task: OCI runtime create failed: runc create failed: ' +
    'unable to start container process: error during container init: ' +
    'exec: "bash": executable file not found in $PATH: unknown.';

  it('[DATA] names the image and the missing executable', () => {
    const hint = missingExecutableHint(ALPINE_STDERR, 'alpine:3.24');
    expect(hint).toContain("'alpine:3.24'");
    expect(hint).toContain("'bash'");
  });

  it('[DATA] points at the Docker image setup guide', () => {
    expect(missingExecutableHint(ALPINE_STDERR, 'alpine:3.24')).toContain(
      'docs/how-to/docker-image-setup.md',
    );
  });

  it('[DATA] falls back to generic wording when the image is unknown', () => {
    const hint = missingExecutableHint(ALPINE_STDERR, undefined);
    expect(hint).toContain("'bash'");
    expect(hint).toContain('The configured image');
  });

  it('[DATA] returns an empty hint for unrelated failures', () => {
    expect(missingExecutableHint('Traceback (most recent call last): KeyError', 'python:3.12-slim')).toBe('');
    expect(missingExecutableHint('', 'alpine:3.24')).toBe('');
  });
});

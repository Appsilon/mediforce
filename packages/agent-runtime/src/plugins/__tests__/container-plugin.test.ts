import { describe, it, expect } from 'vitest';
import {
  formatExitInfo,
  deriveBuildTag,
  missingExecutableHint,
  resolveStepImage,
} from '../container-plugin';

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

  it('[DATA] a build with no context keeps the tag it had before contexts existed', () => {
    // Pinned, not recomputed: every image already on a daemon and every step
    // pin already registered names this exact tag.
    expect(deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile')).toBe(
      'mediforce-built:848270386ea0',
    );
    expect(
      deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile', ''),
    ).toBe('mediforce-built:848270386ea0');
  });

  it('[DATA] a different build context produces a different tag', () => {
    // Same Dockerfile, different files handed to it — a different image, so a
    // shared tag would serve one build's binary to the other from the cache.
    const narrow = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile');
    const wide = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile', '.');
    expect(wide).not.toBe(narrow);
    expect(wide).toMatch(/^mediforce-built:[0-9a-f]{12}$/);
  });

  it('[DATA] spellings of one build context share one tag', () => {
    const repo = 'git@github.com:org/repo.git';
    const root = deriveBuildTag(repo, 'abc1234', 'container/Dockerfile', '.');

    // The same `docker build`, so the same cache slot — a step writing `./`
    // must find the image an entry storing `.` built.
    expect(deriveBuildTag(repo, 'abc1234', 'container/Dockerfile', './')).toBe(root);
    expect(deriveBuildTag(repo, 'abc1234', 'container/Dockerfile', '/')).toBe(root);
    expect(deriveBuildTag(repo, 'abc1234', './container/Dockerfile', '.')).toBe(root);
    expect(deriveBuildTag(repo, 'abc1234', 'Dockerfile', 'container')).toBe(
      deriveBuildTag(repo, 'abc1234', '', 'container/'),
    );
  });
});

describe('resolveStepImage', () => {
  const workflowRepo = { url: 'git@github.com:org/skills.git', commit: 'wf00000' };

  it('[DATA] returns the explicit image when the step names one', () => {
    expect(resolveStepImage({ image: 'my-agent:v3' })).toBe('my-agent:v3');
  });

  it('[DATA] derives the tag a build-mode step runs under when it omits image', () => {
    expect(
      resolveStepImage({ repo: 'git@github.com:org/repo.git', commit: 'abc1234', dockerfile: 'Dockerfile' }),
    ).toBe(deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'Dockerfile'));
  });

  it('[DATA] normalizes an owner/repo shorthand the way the builder does', () => {
    expect(resolveStepImage({ repo: 'org/repo', commit: 'abc1234' })).toBe(
      deriveBuildTag('git@github.com:org/repo.git', 'abc1234', undefined),
    );
  });

  it('[DATA] falls back to the workflow skills repo for a step naming only a dockerfile', () => {
    expect(resolveStepImage({ dockerfile: 'container/Dockerfile' }, workflowRepo)).toBe(
      deriveBuildTag('git@github.com:org/skills.git', 'wf00000', 'container/Dockerfile'),
    );
  });

  it('[DATA] folds the build context into the tag a build-mode step runs under', () => {
    expect(
      resolveStepImage({
        repo: 'git@github.com:org/repo.git',
        commit: 'abc1234',
        dockerfile: 'container/Dockerfile',
        context: '.',
      }),
    ).toBe(deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile', '.'));
    expect(
      resolveStepImage({ dockerfile: 'container/Dockerfile', context: '.' }, workflowRepo),
    ).toBe(deriveBuildTag('git@github.com:org/skills.git', 'wf00000', 'container/Dockerfile', '.'));
  });

  it('[DATA] does not apply the workflow fallback when the workflow has no repo', () => {
    expect(resolveStepImage({ dockerfile: 'container/Dockerfile' })).toBeUndefined();
  });

  it('[DATA] returns undefined for a step with no container config at all', () => {
    expect(resolveStepImage(undefined)).toBeUndefined();
    expect(resolveStepImage({})).toBeUndefined();
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
      'docs/guides/docker-image-setup.md',
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

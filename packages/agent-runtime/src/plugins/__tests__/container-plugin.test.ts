import { describe, it, expect } from 'vitest';
import {
  formatExitInfo,
  deriveBuildTag,
  missingExecutableHint,
  resolveImageBuild,
  resolveStepImage,
} from '../container-plugin';
import { artifactsDir } from '../workflow-artifacts';
import type { WorkflowAgentContext } from '../../interfaces/step-executor-plugin';

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
    expect(resolveStepImage({ dockerfile: 'container/Dockerfile' }, { externalSkillsRepo: workflowRepo })).toBe(
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
      resolveStepImage({ dockerfile: 'container/Dockerfile', context: '.' }, { externalSkillsRepo: workflowRepo }),
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

// Registration used to write the golden image onto a step whose Dockerfile
// came from `externalSkillsRepo`. Those versions are immutable, so the runtime
// must not let their build land on the shared tag.
describe('resolveImageBuild — the golden image is never a build target', () => {
  const skillsRepo = { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) };
  const context = {
    workflowDefinition: { externalSkillsRepo: skillsRepo },
    step: { id: 's1' },
  } as unknown as WorkflowAgentContext;

  it.each(['mediforce-golden-image', 'mediforce-golden-image:latest'])('builds %s steps under their derived tag', (golden) => {
    const build = resolveImageBuild(golden, { dockerfile: 'container/Dockerfile' }, context);
    expect(build?.image).toMatch(/^mediforce-built:[a-f0-9]{12}$/);
    expect(resolveStepImage({ image: golden, dockerfile: 'container/Dockerfile' }, { externalSkillsRepo: skillsRepo })).toBe(build?.image);
  });

  it('builds a step with an empty image under its derived tag', () => {
    expect(resolveImageBuild('', { dockerfile: 'container/Dockerfile' }, context)?.image).toMatch(/^mediforce-built:[a-f0-9]{12}$/);
  });

  it('builds a golden-stamped carried Dockerfile under its content tag', () => {
    const carried = {
      workflowDefinition: { artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }] },
      step: { id: 's1' },
    } as unknown as WorkflowAgentContext;
    expect(resolveImageBuild('mediforce-golden-image', { dockerfile: 'Dockerfile' }, carried)?.image)
      .toMatch(/^mediforce-artifacts:[a-f0-9]{12}$/);
  });

  it('keeps any other image the step named', () => {
    expect(resolveImageBuild('acme/agent:v1', { dockerfile: 'container/Dockerfile' }, context)?.image).toBe('acme/agent:v1');
  });
});

// Building an image from a Dockerfile the workflow carries, with no repository
// anywhere in the picture. This is what lets "it needs pandas and R" be
// answered in the app instead of by a checkout.
describe('resolveImageBuild — a Dockerfile the workflow carries', () => {
  const artifacts = [
    { path: 'Dockerfile', contents: 'FROM python:3.12-slim\nRUN pip install pandas\n' },
    { path: 'scripts/poll.py', contents: 'print("poll")\n' },
  ];

  const contextFor = (
    overrides: { artifacts?: { path: string; contents: string }[]; externalSkillsRepo?: { url: string; commit: string } } = {},
  ): WorkflowAgentContext => ({
    workflowDefinition: {
      artifacts: overrides.artifacts ?? artifacts,
      ...(overrides.externalSkillsRepo ? { externalSkillsRepo: overrides.externalSkillsRepo } : {}),
    },
    step: { id: 's1' },
  } as unknown as WorkflowAgentContext);

  it('builds from the materialized files, not a clone', () => {
    const build = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor());
    expect(build?.contextDir).toBe(artifactsDir(artifacts));
    expect(build?.repoUrl).toBeUndefined();
    expect(build?.commit).toBeUndefined();
    expect(build?.dockerfile).toBe('Dockerfile');
  });

  it('derives the tag from the files, so an edit builds a new image and a rerun does not', () => {
    const first = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor());
    const same = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor());
    const edited = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor({
      artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.13-slim\n' }],
    }));
    expect(first?.image).toBe(same?.image);
    expect(first?.image).not.toBe(edited?.image);
    expect(first?.image).toMatch(/^mediforce-artifacts:[a-f0-9]{12}$/);
  });

  it('keeps an image the step named explicitly', () => {
    const build = resolveImageBuild('my-registry/mine:v2', { dockerfile: 'Dockerfile' }, contextFor());
    expect(build?.image).toBe('my-registry/mine:v2');
    expect(build?.contextDir).toBe(artifactsDir(artifacts));
  });

  it('hands the builder the content hash, so an image the step named is rebuilt after an edit', () => {
    // A named tag says nothing about the files, unlike the derived one; the
    // builder compares this hash with the one labelled on the image.
    const derived = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor());
    const named = resolveImageBuild('my-registry/mine:v2', { dockerfile: 'Dockerfile' }, contextFor());
    const edited = resolveImageBuild('my-registry/mine:v2', { dockerfile: 'Dockerfile' }, contextFor({
      artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.13-slim\n' }],
    }));
    expect(named?.artifactsHash).toBe(derived?.image.replace('mediforce-artifacts:', ''));
    expect(edited?.artifactsHash).not.toBe(named?.artifactsHash);
  });

  it('leaves an explicit repo and commit in charge', () => {
    // A step that names its own build source said something specific; the
    // carried files are the fallback, not an override.
    const build = resolveImageBuild(undefined, {
      dockerfile: 'Dockerfile',
      repo: 'https://github.com/org/agent.git',
      commit: 'a'.repeat(40),
    }, contextFor());
    expect(build?.contextDir).toBeUndefined();
    expect(build?.commit).toBe('a'.repeat(40));
  });

  it('falls back to the skills repo when the carried files hold no such Dockerfile', () => {
    const build = resolveImageBuild(undefined, { dockerfile: 'container/Dockerfile' }, contextFor({
      externalSkillsRepo: { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) },
    }));
    expect(build?.contextDir).toBeUndefined();
    expect(build?.commit).toBe('b'.repeat(40));
  });

  it('has nothing to build when a step names no Dockerfile', () => {
    expect(resolveImageBuild('some:image', {}, contextFor())).toBeUndefined();
  });

  it('agrees with the pin scan when the workflow also has a skills repo', () => {
    // `resolveStepImage` is what decides which images a version pins, so it
    // must name the tag the runtime builds rather than a `mediforce-built:*`
    // one from the skills repo the carried Dockerfile outranks.
    const skillsRepo = { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) };
    const build = resolveImageBuild(undefined, { dockerfile: 'Dockerfile' }, contextFor({ externalSkillsRepo: skillsRepo }));
    expect(resolveStepImage({ dockerfile: 'Dockerfile' }, { artifacts, externalSkillsRepo: skillsRepo })).toBe(build?.image);
    expect(build?.image).toMatch(/^mediforce-artifacts:/);
  });
});

// A published Image Catalog entry is named `<workspace>/<name>`, and the upload
// path refuses to replace a tag that exists so a step pinning it cannot start
// running something else. A build must not walk around that.
describe('resolveImageBuild — an image the catalog published is never a build target', () => {
  const artifacts = [{ path: 'container/Dockerfile', contents: 'FROM alpine:3.21\n' }];
  const contextFor = (namespace: string): WorkflowAgentContext => ({
    workflowDefinition: { artifacts, name: 'test-artifacts', namespace },
    step: { id: 's1' },
  } as unknown as WorkflowAgentContext);

  it('builds the carried files under their own tag, leaving the published image alone', () => {
    const build = resolveImageBuild(
      'db/test-artifacts:test-publish-as-image',
      { dockerfile: 'container/Dockerfile' },
      contextFor('db'),
    );

    // Otherwise the run rebuilds the published tag from the carried files: the
    // image the catalog offers is replaced, and two entries claim one artifact.
    expect(build?.image).toMatch(/^mediforce-artifacts:[a-f0-9]{12}$/);
  });

  it('agrees with the pin scan, so "used by" names the tag that actually runs', () => {
    const build = resolveImageBuild(
      'db/test-artifacts:test-publish-as-image',
      { dockerfile: 'container/Dockerfile' },
      contextFor('db'),
    );
    expect(resolveStepImage(
      { image: 'db/test-artifacts:test-publish-as-image', dockerfile: 'container/Dockerfile' },
      { artifacts, name: 'test-artifacts', namespace: 'db' },
    )).toBe(build?.image);
  });

  it('keeps a name outside this workspace, which the catalog does not own', () => {
    expect(resolveImageBuild('my-registry/mine:v2', { dockerfile: 'container/Dockerfile' }, contextFor('db'))?.image)
      .toBe('my-registry/mine:v2');
    expect(resolveImageBuild('mine:v2', { dockerfile: 'container/Dockerfile' }, contextFor('db'))?.image)
      .toBe('mine:v2');
  });

  it('applies to a repo build too, which can overwrite a published image just as easily', () => {
    const build = resolveImageBuild(
      'db/test-artifacts:v1',
      { dockerfile: 'Dockerfile', repo: 'https://github.com/org/agent.git', commit: 'a'.repeat(40) },
      contextFor('db'),
    );
    expect(build?.image).toMatch(/^mediforce-built:[a-f0-9]{12}$/);
  });
});

// The whole carried set is always the build context, which is what lets a
// `container/Dockerfile` `COPY scripts/`, so every carried file counts towards
// the content hash.
describe('resolveImageBuild — the context of a carried Dockerfile', () => {
  const dockerfile = { path: 'container/Dockerfile', contents: 'FROM python:3.12-slim\nCOPY scripts/ /scripts/\n' };
  const entrypoint = { path: 'container/entrypoint.sh', contents: 'echo hi\n' };
  const script = { path: 'scripts/poll.py', contents: 'print("poll")\n' };
  const buildFor = (
    files: { path: string; contents: string }[],
    config: { dockerfile: string; context?: string } = { dockerfile: dockerfile.path },
    definition: { name?: string; namespace?: string } = { name: 'wf', namespace: 'acme' },
  ) => resolveImageBuild(undefined, config, {
    workflowDefinition: { artifacts: files, ...definition },
    step: { id: 's1' },
  } as unknown as WorkflowAgentContext);

  it('hands the builder the Dockerfile as the step named it, labelled with the workflow', () => {
    const build = buildFor([dockerfile, entrypoint, script]);
    expect(build?.dockerfile).toBe('container/Dockerfile');
    expect(build?.contextDir).toBe(artifactsDir([dockerfile, entrypoint, script]));
    expect(build?.workflow).toBe('wf');
    expect(build?.namespace).toBe('acme');
  });

  it("rebuilds for an edit anywhere in the carried files, since all of them are the context", () => {
    const before = buildFor([dockerfile, entrypoint, script]);
    const after = buildFor([dockerfile, entrypoint, { ...script, contents: 'print("edited")\n' }]);
    expect(after?.artifactsHash).not.toBe(before?.artifactsHash);
  });

  it('ignores a context the step names, building from every carried file as it always has', () => {
    // A registered version cannot be edited, so one naming `context` next to a
    // carried Dockerfile must keep building the way it did before carried
    // images were catalogued.
    const files = [dockerfile, entrypoint, script];
    const plain = buildFor(files);
    const named = buildFor(files, { dockerfile: dockerfile.path, context: 'container' });
    expect(named?.context).toBeUndefined();
    expect(named?.image).toBe(plain?.image);
    expect(named?.artifactsHash).toBe(plain?.artifactsHash);
    expect(buildFor([dockerfile, entrypoint], { dockerfile: 'Dockerfile', context: 'container' })).toBeUndefined();
  });

  it('builds identical files carried by two workflows as two images', () => {
    // Each image is labelled with the workflow it is offered under in the
    // Image Catalog, and a shared tag could carry only one of them.
    expect(buildFor([dockerfile], undefined, { name: 'a', namespace: 'acme' })?.image)
      .not.toBe(buildFor([dockerfile], undefined, { name: 'b', namespace: 'acme' })?.image);
  });
});

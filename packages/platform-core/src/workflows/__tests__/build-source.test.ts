import { describe, it, expect } from 'vitest';
import { carriedBuildPaths, carriedContextFiles, stepHasBuildSource } from '../build-source';

describe('stepHasBuildSource', () => {
  const dockerfile = { artifacts: [{ path: 'Dockerfile', contents: 'FROM python:3.12-slim\n' }] };
  const skillsRepo = { externalSkillsRepo: { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) } };

  it('is true for a repo pinned to a commit', () => {
    expect(stepHasBuildSource(
      { repo: 'https://github.com/org/agent.git', commit: 'a'.repeat(40) },
      undefined,
    )).toBe(true);
  });

  it('is false for a repo with no commit, which builds nothing', () => {
    expect(stepHasBuildSource({ repo: 'https://github.com/org/agent.git' }, undefined)).toBe(false);
  });

  it('is true for a Dockerfile the workflow carries', () => {
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, dockerfile)).toBe(true);
  });

  it('is false for a Dockerfile the workflow does not carry', () => {
    // Naming a file that is not there is not a build source: the step still
    // needs an image, and saying otherwise would leave it with none.
    expect(stepHasBuildSource({ dockerfile: 'container/Dockerfile' }, dockerfile)).toBe(false);
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, undefined)).toBe(false);
    expect(stepHasBuildSource({ dockerfile: 'Dockerfile' }, { artifacts: [] })).toBe(false);
  });

  it('is true for a Dockerfile the workflow\'s skills repo builds from', () => {
    // The runtime falls back to `externalSkillsRepo` for a step naming only a
    // Dockerfile. Missing that here handed the step the golden image, and the
    // build then replaced the shared golden image with this workflow's.
    expect(stepHasBuildSource({ dockerfile: 'container/Dockerfile' }, skillsRepo)).toBe(true);
  });

  it('is false for a skills repo when the step names no Dockerfile', () => {
    expect(stepHasBuildSource({}, skillsRepo)).toBe(false);
  });

  it('is false for a step that names neither', () => {
    expect(stepHasBuildSource({ image: 'python:3.12-slim' }, dockerfile)).toBe(false);
    expect(stepHasBuildSource({}, dockerfile)).toBe(false);
    expect(stepHasBuildSource(undefined, dockerfile)).toBe(false);
  });
});

describe('carriedBuildPaths', () => {
  const artifacts = [
    { path: 'container/Dockerfile', contents: 'FROM alpine:3.21\nCOPY scripts/ /scripts/\n' },
    { path: 'container/entrypoint.sh', contents: 'echo hi\n' },
    { path: 'scripts/poll.py', contents: 'print("poll")\n' },
  ];

  it('builds a carried Dockerfile from the whole carried set, so it can COPY a sibling directory', () => {
    expect(carriedBuildPaths({ dockerfile: 'container/Dockerfile' }, artifacts)).toEqual({
      dockerfile: 'container/Dockerfile',
      context: '',
    });
  });

  it('narrows the context to the directory a step names, keeping the Dockerfile path as written', () => {
    // Unlike a repository build, `dockerfile` is not re-read from the context:
    // a carried file is named by its path from the root everywhere else.
    expect(carriedBuildPaths({ dockerfile: 'container/Dockerfile', context: 'container' }, artifacts)).toEqual({
      dockerfile: 'container/Dockerfile',
      context: 'container',
    });
  });

  it('treats "." and "" as the whole set, so equivalent spellings build one image', () => {
    expect(carriedBuildPaths({ dockerfile: 'container/Dockerfile', context: '.' }, artifacts)?.context).toBe('');
    expect(carriedBuildPaths({ dockerfile: './container/Dockerfile' }, artifacts)?.dockerfile).toBe('container/Dockerfile');
  });

  it('is null for a Dockerfile the workflow does not carry, or one that climbs out', () => {
    expect(carriedBuildPaths({ dockerfile: 'Dockerfile' }, artifacts)).toBeNull();
    expect(carriedBuildPaths({ dockerfile: '../Dockerfile' }, artifacts)).toBeNull();
    expect(carriedBuildPaths({ dockerfile: 'container/Dockerfile', context: '..' }, artifacts)).toBeNull();
  });

  it('is null when the step names its own repo and commit, which said something more specific', () => {
    expect(carriedBuildPaths(
      { dockerfile: 'container/Dockerfile', repo: 'org/agent', commit: 'a'.repeat(40) },
      artifacts,
    )).toBeNull();
  });
});

describe('carriedContextFiles', () => {
  const artifacts = [
    { path: 'container/Dockerfile', contents: 'FROM alpine:3.21\n' },
    { path: 'scripts/poll.py', contents: 'print("poll")\n' },
  ];

  it('sends every carried file when the context is the whole set', () => {
    expect(carriedContextFiles(artifacts, { dockerfile: 'container/Dockerfile', context: '' })).toEqual(artifacts);
  });

  it('sends only what is inside a named context, with paths from its root', () => {
    expect(carriedContextFiles(artifacts, { dockerfile: 'container/Dockerfile', context: 'container' })).toEqual([
      { path: 'Dockerfile', contents: 'FROM alpine:3.21\n' },
    ]);
  });
});

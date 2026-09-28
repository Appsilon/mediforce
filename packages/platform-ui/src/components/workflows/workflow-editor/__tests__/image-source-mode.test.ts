import { describe, it, expect } from 'vitest';
import {
  carriedDockerfileOptions,
  clearForMode,
  deriveImageSourceMode,
  unusedFieldsForMode,
  type ImageSourceDefinition,
} from '../image-source-mode';

const CARRIED: ImageSourceDefinition = {
  namespace: 'db',
  artifacts: [
    { path: 'container/Dockerfile', contents: 'FROM alpine:3.21\n' },
    { path: 'scripts/run.py', contents: 'print("run")\n' },
  ],
};

const SKILLS_REPO: ImageSourceDefinition = {
  namespace: 'db',
  externalSkillsRepo: { url: 'https://github.com/org/skills.git', commit: 'b'.repeat(40) },
};

describe('deriveImageSourceMode', () => {
  it('reads a step that names only an image as a ready image', () => {
    expect(deriveImageSourceMode({ image: 'python:3.11-slim' }, CARRIED)).toBe('ready');
    expect(deriveImageSourceMode({}, CARRIED)).toBe('ready');
    expect(deriveImageSourceMode(undefined, CARRIED)).toBe('ready');
  });

  it('reads an explicit repo and commit as a repo build, ahead of the carried files', () => {
    expect(deriveImageSourceMode(
      { dockerfile: 'container/Dockerfile', repo: 'org/agent', commit: 'a'.repeat(40) },
      CARRIED,
    )).toBe('repo');
  });

  it('reads a Dockerfile the workflow carries as a carried build', () => {
    expect(deriveImageSourceMode({ dockerfile: 'container/Dockerfile' }, CARRIED)).toBe('carried');
  });

  it('reads a bare Dockerfile behind the skills repo as a repo build', () => {
    expect(deriveImageSourceMode({ dockerfile: 'container/Dockerfile' }, SKILLS_REPO)).toBe('repo');
  });

  it('reads a Dockerfile with nothing to build it from as a repo build, where the repo can be supplied', () => {
    expect(deriveImageSourceMode({ dockerfile: 'container/Dockerfile' }, { namespace: 'db' })).toBe('repo');
  });

  it('follows the runtime when a step sets an image and a carried Dockerfile at once', () => {
    // The carried files win at run time, so the editor opens on them rather
    // than on the image that is never used.
    expect(deriveImageSourceMode(
      { image: 'db/test-artifacts:v1', dockerfile: 'container/Dockerfile' },
      CARRIED,
    )).toBe('carried');
  });
});

describe('clearForMode', () => {
  it('clears every build field when switching to a ready image', () => {
    expect(clearForMode('ready')).toEqual({
      image: undefined,
      dockerfile: undefined,
      context: undefined,
      repo: undefined,
      commit: undefined,
      repoAuth: undefined,
    });
  });

  it('drops the image when entering a build mode, because it stops meaning the same thing', () => {
    // In a build mode `image` is the tag to build under, not an image to run;
    // carrying the old value across would silently re-interpret it.
    expect(clearForMode('carried')).toEqual({
      image: undefined,
      repo: undefined,
      commit: undefined,
      repoAuth: undefined,
    });
    expect(clearForMode('repo')).toEqual({ image: undefined });
  });

  it('keeps the Dockerfile when moving between build modes, and the context only for a repo', () => {
    expect(Object.keys(clearForMode('repo'))).not.toContain('dockerfile');
    expect(Object.keys(clearForMode('repo'))).not.toContain('context');
    expect(Object.keys(clearForMode('carried'))).not.toContain('dockerfile');
    // A carried build always reads every carried file.
    expect(Object.keys(clearForMode('carried'))).toContain('context');
  });
});

describe('unusedFieldsForMode', () => {
  it('names the build fields a ready image ignores', () => {
    expect(unusedFieldsForMode('ready', { image: 'x', dockerfile: 'D', repo: 'r' }, CARRIED))
      .toEqual(['dockerfile', 'repo']);
  });

  it('names a context, which a carried build ignores', () => {
    expect(unusedFieldsForMode('carried', { dockerfile: 'container/Dockerfile', context: 'container' }, CARRIED))
      .toEqual(['context']);
  });

  it('names the repo fields a carried build ignores', () => {
    expect(unusedFieldsForMode('carried', { dockerfile: 'container/Dockerfile', repo: 'r', commit: 'c' }, CARRIED))
      .toEqual(['repo', 'commit']);
  });

  it('names an image the catalog owns, which a build is refused from replacing', () => {
    expect(unusedFieldsForMode('carried', { image: 'db/test-artifacts:v1', dockerfile: 'container/Dockerfile' }, CARRIED))
      .toEqual(['image']);
  });

  it('says nothing about a build tag the build actually uses', () => {
    expect(unusedFieldsForMode('carried', { image: 'my-thing:latest', dockerfile: 'container/Dockerfile' }, CARRIED))
      .toEqual([]);
  });
});

describe('carriedDockerfileOptions', () => {
  it('offers the carried files that are Dockerfiles, and nothing else', () => {
    expect(carriedDockerfileOptions(CARRIED, undefined)).toEqual(['container/Dockerfile']);
  });

  it('keeps a stored path the workflow no longer carries, so opening the editor re-points nothing', () => {
    expect(carriedDockerfileOptions(CARRIED, 'gone/Dockerfile')).toEqual([
      'gone/Dockerfile',
      'container/Dockerfile',
    ]);
  });

  it('is empty for a workflow that carries no Dockerfile', () => {
    expect(carriedDockerfileOptions({ namespace: 'db', artifacts: [] }, undefined)).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import {
  BuildContextSchema,
  builtSourceLine,
  catalogDockerfileKey,
  resolveDockerBuildPaths,
} from '../docker-build-paths';

describe('resolveDockerBuildPaths', () => {
  describe('without a context — the contract every existing step was written against', () => {
    it('builds from the directory the Dockerfile sits in', () => {
      expect(resolveDockerBuildPaths('container/Dockerfile', undefined)).toEqual({
        dockerfile: 'container/Dockerfile',
        context: 'container',
      });
    });

    it('defaults to the Dockerfile at the repo root', () => {
      expect(resolveDockerBuildPaths(undefined, undefined)).toEqual({
        dockerfile: 'Dockerfile',
        context: '',
      });
      expect(resolveDockerBuildPaths('', undefined)).toEqual({ dockerfile: 'Dockerfile', context: '' });
    });

    it('treats an empty context as no context', () => {
      expect(resolveDockerBuildPaths('container/Dockerfile', '')).toEqual({
        dockerfile: 'container/Dockerfile',
        context: 'container',
      });
    });

    it('reads a leading slash as the repo root, as joining it onto the clone always did', () => {
      expect(resolveDockerBuildPaths('/container/Dockerfile', undefined)).toEqual({
        dockerfile: 'container/Dockerfile',
        context: 'container',
      });
    });
  });

  describe('with a context — docker-compose semantics', () => {
    it('resolves the Dockerfile from the context, so a subdirectory Dockerfile sees the whole repo', () => {
      expect(resolveDockerBuildPaths('container/Dockerfile', '.')).toEqual({
        dockerfile: 'container/Dockerfile',
        context: '',
      });
    });

    it('defaults to the Dockerfile inside the context', () => {
      expect(resolveDockerBuildPaths('', 'container')).toEqual({
        dockerfile: 'container/Dockerfile',
        context: 'container',
      });
    });

    it('allows a Dockerfile outside the context as long as it stays in the repo', () => {
      expect(resolveDockerBuildPaths('../container/Dockerfile', 'app')).toEqual({
        dockerfile: 'container/Dockerfile',
        context: 'app',
      });
    });
  });

  describe('refuses a path that leaves the clone', () => {
    it('refuses a context above the repo root', () => {
      expect(() => resolveDockerBuildPaths('Dockerfile', '../..')).toThrow(/outside the repository/);
    });

    it('refuses a Dockerfile above the repo root', () => {
      expect(() => resolveDockerBuildPaths('../../etc/Dockerfile', 'app')).toThrow(
        /outside the repository/,
      );
      expect(() => resolveDockerBuildPaths('../Dockerfile', undefined)).toThrow(
        /outside the repository/,
      );
    });
  });
});

describe('catalogDockerfileKey', () => {
  it('is the dockerfile exactly as written when there is no context, so no existing entry id moves', () => {
    expect(catalogDockerfileKey('', undefined)).toBe('');
    expect(catalogDockerfileKey('container/Dockerfile', undefined)).toBe('container/Dockerfile');
    expect(catalogDockerfileKey('./container/Dockerfile', '')).toBe('./container/Dockerfile');
  });

  it('is the path from the repo root when there is a context — the file, not how it is built', () => {
    expect(catalogDockerfileKey('Dockerfile', 'container')).toBe('container/Dockerfile');
    expect(catalogDockerfileKey('container/Dockerfile', '.')).toBe('container/Dockerfile');
  });

  it('never throws, because it also keys images read back off the daemon', () => {
    expect(catalogDockerfileKey('Dockerfile', '../..')).toBe('../../Dockerfile');
  });
});

describe('builtSourceLine', () => {
  it('names only what the source sets, an empty context included', () => {
    expect(builtSourceLine('org/repo', '', undefined)).toBe('org/repo');
    expect(builtSourceLine('org/repo', 'container/Dockerfile', '')).toBe('org/repo · container/Dockerfile');
    expect(builtSourceLine('org/repo', 'container/Dockerfile', '.')).toBe(
      'org/repo · container/Dockerfile · context .',
    );
  });
});

describe('BuildContextSchema', () => {
  it('accepts a directory inside the repo, the root included', () => {
    expect(BuildContextSchema.safeParse('.').success).toBe(true);
    expect(BuildContextSchema.safeParse('scripts/../container').success).toBe(true);
  });

  it('refuses a directory above the repo root', () => {
    expect(BuildContextSchema.safeParse('../other').success).toBe(false);
  });
});

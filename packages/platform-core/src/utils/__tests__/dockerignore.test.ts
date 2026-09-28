import { describe, expect, it } from 'vitest';
import { buildContextFilter, dockerignoreCandidates } from '../dockerignore';

function excludedBy(text: string, path: string): boolean {
  return buildContextFilter('Dockerfile', { path: '.dockerignore', text }).excludes(path);
}

describe('buildContextFilter — pattern matching', () => {
  // moby/patternmatcher's own table, the matcher `docker build` runs.
  it.each([
    ['**', 'file', true],
    ['**', 'dir/file', true],
    ['**/', 'dir/file', true],
    ['**/**', 'dir/file', true],
    ['dir/**', 'dir/file', true],
    ['dir/**', 'dir/dir2/file', true],
    ['**/dir', 'dir', true],
    ['**/dir', 'dir/file', true],
    ['**/dir2/*', 'dir/dir2/file', true],
    ['**/dir2/**', 'dir/dir2/dir3/file', true],
    ['**file', 'file', true],
    ['**file', 'dir/file', true],
    ['**/file', 'dir/file', true],
    ['**file', 'dir/dir/file', true],
    ['**/file', 'dir/dir/file', true],
    ['**/file*', 'dir/dir/file', true],
    ['**/file*', 'dir/dir/file.txt', true],
    ['**/file*txt', 'dir/dir/file.txt', true],
    ['**/file*.txt', 'dir/dir/file.txt', true],
    ['**/file*.txt*', 'dir/dir/file.txt', true],
    ['**/**/*.txt', 'dir/dir/file.txt', true],
    ['**/**/*.txt2', 'dir/dir/file.txt', false],
    ['**/*.txt', 'file.txt', true],
    ['**/**/*.txt', 'file.txt', true],
    ['a**/*.txt', 'a/file.txt', true],
    ['a**/*.txt', 'a/dir/file.txt', true],
    ['a**/*.txt', 'a/dir/dir/file.txt', true],
    ['a/*.txt', 'a/dir/file.txt', false],
    ['a/*.txt', 'a/file.txt', true],
    ['a/*.txt**', 'a/file.txt', true],
    ['a[b-d]e', 'ae', false],
    ['a[b-d]e', 'ace', true],
    ['a[b-d]e', 'aae', false],
    ['a[^b-d]e', 'aze', true],
    ['.*', '.foo', true],
    ['.*', 'foo', false],
    ['abc.def', 'abcdef', false],
    ['abc.def', 'abc.def', true],
    ['abc.def', 'abcZdef', false],
    ['abc?def', 'abcZdef', true],
    ['abc?def', 'abcdef', false],
    ['a\\\\', 'a\\', true],
    ['**/foo/bar', 'foo/bar', true],
    ['**/foo/bar', 'dir/foo/bar', true],
    ['**/foo/bar', 'dir/dir2/foo/bar', true],
    ['abc/**', 'abc', false],
    ['abc/**', 'abc/def', true],
    ['abc/**', 'abc/def/ghi', true],
    ['**/.foo', '.foo', true],
    ['**/.foo', 'bar.foo', false],
    ['a(b)c/def', 'a(b)c/def', true],
    ['a(b)c/def', 'a(b)c/xyz', false],
    ['a.|)$(}+{bc', 'a.|)$(}+{bc', true],
    ['dist/*.whl', 'dist/proxy.py-2.4.0rc3.dev36+g08acad9-py3-none-any.whl', true],
  ])('%s against %s is %s', (pattern, path, expected) => {
    expect(excludedBy(pattern, path)).toBe(expected);
  });

  it('excludes everything under a matched directory', () => {
    expect(excludedBy('sample-data', 'sample-data/study-1/dm.xpt')).toBe(true);
    expect(excludedBy('sample-data/', 'sample-data/dm.xpt')).toBe(true);
    expect(excludedBy('*/fixtures', 'tests/fixtures/big.bin')).toBe(true);
    expect(excludedBy('sample-data', 'scripts/sample-data.R')).toBe(false);
  });

  it('reads patterns from the context root, as docker cleans them', () => {
    expect(excludedBy('/node_modules', 'node_modules/x/index.js')).toBe(true);
    expect(excludedBy('./build/../dist', 'dist/app.js')).toBe(true);
    expect(excludedBy('  logs  ', 'logs/today.log')).toBe(true);
  });

  it('skips comments and blank lines, but only a # that starts the line', () => {
    const text = '# sample-data\n\n   \n #notes\n';
    expect(excludedBy(text, 'sample-data/dm.xpt')).toBe(false);
    expect(excludedBy(text, '#notes')).toBe(true);
  });

  it('lets a later ! pattern bring a path back, and a later exclude take it away again', () => {
    const text = '*\n!scripts\nscripts/*.tmp\n';
    expect(excludedBy(text, 'sample-data/dm.xpt')).toBe(true);
    expect(excludedBy(text, 'scripts/run.sh')).toBe(false);
    expect(excludedBy(text, 'scripts/scratch.tmp')).toBe(true);
  });

  it('reads a UTF-8 byte order mark on the first line as nothing', () => {
    expect(excludedBy('﻿sample-data\n', 'sample-data/dm.xpt')).toBe(true);
  });

  it('skips a pattern docker cannot compile rather than guess at it', () => {
    expect(excludedBy('[unclosed\n', '[unclosed')).toBe(false);
    expect(excludedBy('!\nsample-data', 'sample-data/dm.xpt')).toBe(true);
  });
});

describe('buildContextFilter — what is always sent', () => {
  it('sends the Dockerfile and the ignore file even when a pattern names them', () => {
    const filter = buildContextFilter('container/Dockerfile', { path: '.dockerignore', text: '*\n!scripts\n' });

    expect(filter.excludes('container/Dockerfile')).toBe(false);
    expect(filter.excludes('.dockerignore')).toBe(false);
    expect(filter.excludes('container/other.txt')).toBe(true);
    expect([...filter.required].sort()).toEqual(['.dockerignore', 'container/Dockerfile']);
  });

  it('excludes nothing when the context has no ignore file', () => {
    const filter = buildContextFilter('Dockerfile', null);

    expect(filter.ignoreFile).toBeNull();
    expect(filter.excludes('sample-data/dm.xpt')).toBe(false);
    expect([...filter.required]).toEqual(['Dockerfile']);
  });
});

describe('buildContextFilter — skipsDirectory', () => {
  it('skips an excluded directory when nothing can bring a path under it back', () => {
    const filter = buildContextFilter('Dockerfile', { path: '.dockerignore', text: 'sample-data\n' });

    expect(filter.skipsDirectory('sample-data')).toBe(true);
    expect(filter.skipsDirectory('scripts')).toBe(false);
  });

  it('walks an excluded directory an exception may reach into', () => {
    const filter = buildContextFilter('Dockerfile', { path: '.dockerignore', text: 'data\n!data/keep.csv\n' });

    expect(filter.skipsDirectory('data')).toBe(false);
    expect(filter.excludes('data/drop.csv')).toBe(true);
    expect(filter.excludes('data/keep.csv')).toBe(false);
  });

  it('walks an excluded directory holding the Dockerfile', () => {
    const filter = buildContextFilter('container/Dockerfile', { path: '.dockerignore', text: 'container\n' });

    expect(filter.skipsDirectory('container')).toBe(false);
    expect(filter.excludes('container/Dockerfile')).toBe(false);
  });
});

describe('dockerignoreCandidates', () => {
  it('prefers the ignore file beside the Dockerfile, as BuildKit does, then the root one', () => {
    expect(dockerignoreCandidates('container/Dockerfile')).toEqual([
      'container/Dockerfile.dockerignore',
      '.dockerignore',
    ]);
    expect(dockerignoreCandidates('./Dockerfile')).toEqual(['Dockerfile.dockerignore', '.dockerignore']);
    expect(dockerignoreCandidates('')).toEqual(['Dockerfile.dockerignore', '.dockerignore']);
  });

  it('falls back to the root one alone for a Dockerfile outside the context', () => {
    expect(dockerignoreCandidates('../Dockerfile')).toEqual(['.dockerignore']);
  });
});

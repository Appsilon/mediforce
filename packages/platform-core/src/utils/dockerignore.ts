/**
 * `.dockerignore` read the way `docker build` reads it, so the CLI and the
 * Images view upload only what the build would see (#1345, ADR-0022).
 *
 * A port of moby/patternmatcher — its pattern compiler and
 * `MatchesOrParentMatches` — and of `ignorefile.ReadAll`, which cleans each
 * line. Plain string logic, not `node:path`: the Images view runs it in the
 * browser. The build host applies the file again, so a pattern read wrongly
 * here can only fail loud: a file dropped that Docker would have kept is a
 * `COPY` that cannot find it.
 */

import { resolveDockerBuildPaths } from './docker-build-paths';

type MatchType = 'exact' | 'prefix' | 'suffix' | 'regexp';

interface Pattern {
  cleaned: string;
  exclusion: boolean;
  matchType: MatchType;
  regexp: RegExp | null;
}

/** Characters with a meaning in a regexp but none in a `filepath.Match` pattern. */
const REGEXP_ONLY = '.+()|{}$';

/** Go's `filepath.Clean` for `/`-separated paths. */
function cleanPath(path: string): string {
  if (path === '') return '.';
  const rooted = path.startsWith('/');
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = segments[segments.length - 1];
      if (last !== undefined && last !== '..') segments.pop();
      else if (rooted === false) segments.push('..');
      continue;
    }
    segments.push(segment);
  }
  const joined = segments.join('/');
  if (rooted) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

/** The patterns of an ignore file, as `ignorefile.ReadAll` hands them on. */
function readPatternLines(text: string): string[] {
  const patterns: string[] = [];
  text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .forEach((line) => {
      if (line.startsWith('#')) return;
      let pattern = line.trim();
      if (pattern === '') return;
      const invert = pattern.startsWith('!');
      if (invert) pattern = pattern.slice(1).trim();
      if (pattern !== '') {
        pattern = cleanPath(pattern);
        if (pattern.length > 1 && pattern.startsWith('/')) pattern = pattern.slice(1);
      }
      patterns.push(invert ? `!${pattern}` : pattern);
    });
  return patterns;
}

/** One pattern compiled as moby compiles it, or null for one it refuses. */
function compilePattern(line: string): Pattern | null {
  let cleaned = cleanPath(line.trim());
  const exclusion = cleaned.startsWith('!');
  if (exclusion) cleaned = cleaned.slice(1);
  if (cleaned === '') return null;

  let source = '^';
  let matchType: MatchType = 'exact';
  const chars = [...cleaned];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const isFirst = index === 0;
    if (char === '*') {
      if (chars[index + 1] === '*') {
        index += 1;
        // `**/` is `**`: the slash is eaten.
        if (chars[index + 1] === '/') index += 1;
        if (index + 1 >= chars.length) {
          // A trailing `**` takes everything, as in .gitignore.
          if (matchType === 'exact') {
            matchType = 'prefix';
          } else {
            source += '.*';
            matchType = 'regexp';
          }
        } else {
          // Any number of directories, none included.
          source += '(.*/)?';
          matchType = 'regexp';
        }
        if (isFirst) matchType = 'suffix';
      } else {
        source += '[^/]*';
        matchType = 'regexp';
      }
    } else if (char === '?') {
      source += '[^/]';
      matchType = 'regexp';
    } else if (char !== undefined && REGEXP_ONLY.includes(char)) {
      source += `\\${char}`;
    } else if (char === '\\') {
      // A trailing backslash escapes nothing, which `filepath.Match` refuses.
      index += 1;
      const escaped = chars[index];
      if (escaped === undefined) return null;
      source += `\\${escaped}`;
      matchType = 'regexp';
    } else if (char === '[' || char === ']') {
      source += char;
      matchType = 'regexp';
    } else {
      source += char ?? '';
    }
  }

  if (matchType !== 'regexp') return { cleaned, exclusion, matchType, regexp: null };
  try {
    return { cleaned, exclusion, matchType, regexp: new RegExp(`${source}$`) };
  } catch {
    return null;
  }
}

function patternMatches(pattern: Pattern, path: string): boolean {
  switch (pattern.matchType) {
    case 'exact':
      return path === pattern.cleaned;
    case 'prefix':
      return path.startsWith(pattern.cleaned.slice(0, -2));
    case 'suffix': {
      const suffix = pattern.cleaned.slice(2);
      if (path.endsWith(suffix)) return true;
      // `**/foo` matches `foo`.
      return suffix.startsWith('/') && path === suffix.slice(1);
    }
    case 'regexp':
      return pattern.regexp?.test(path) === true;
  }
}

/** `MatchesOrParentMatches`: the last pattern to match `path` or a directory
 *  above it decides, and a `!` pattern brings a path back. */
function matchesOrParentMatches(patterns: readonly Pattern[], path: string): boolean {
  const file = cleanPath(path);
  const slash = file.lastIndexOf('/');
  const parentDirs = slash === -1 ? [] : file.slice(0, slash).split('/');
  let matched = false;
  for (const pattern of patterns) {
    // An include already matched, or an exclusion with nothing to undo.
    if (pattern.exclusion !== matched) continue;
    let match = patternMatches(pattern, file);
    for (let depth = 1; match === false && depth <= parentDirs.length; depth += 1) {
      match = patternMatches(pattern, parentDirs.slice(0, depth).join('/'));
    }
    if (match) matched = pattern.exclusion === false;
  }
  return matched;
}

export interface BuildContextFilter {
  /** The ignore file applied, or null when the context has none. */
  ignoreFile: string | null;
  /** The Dockerfile and the ignore file: sent whatever the patterns say, as
   *  Docker sends them — the build host reads both. */
  required: ReadonlySet<string>;
  /** Whether `path`, from the context root, stays out of the upload. */
  excludes(path: string): boolean;
  /** Whether a walk can pass directory `path` by without looking inside:
   *  excluded, with no `!` pattern or required file to bring anything back. */
  skipsDirectory(path: string): boolean;
}

function contextDockerfile(dockerfile: string): string | null {
  try {
    return resolveDockerBuildPaths(dockerfile, '.').dockerfile;
  } catch {
    return null;
  }
}

/**
 * The ignore files a build of `dockerfile` reads, the first that exists
 * winning: BuildKit's `<Dockerfile>.dockerignore` beside the Dockerfile, then
 * the context root's `.dockerignore`.
 */
export function dockerignoreCandidates(dockerfile: string): string[] {
  const resolved = contextDockerfile(dockerfile);
  return resolved === null ? ['.dockerignore'] : [`${resolved}.dockerignore`, '.dockerignore'];
}

/** Which paths of a context the upload for `dockerfile` leaves out, given the
 *  ignore file `dockerignoreCandidates` found (null when none exists). */
export function buildContextFilter(
  dockerfile: string,
  ignoreFile: { path: string; text: string } | null,
): BuildContextFilter {
  const patterns = ignoreFile === null
    ? []
    : readPatternLines(ignoreFile.text)
        .map(compilePattern)
        .filter((pattern): pattern is Pattern => pattern !== null);
  const resolvedDockerfile = contextDockerfile(dockerfile);
  const required = new Set(
    [resolvedDockerfile, ignoreFile?.path ?? null].filter((path): path is string => path !== null),
  );
  const hasExceptions = patterns.some((pattern) => pattern.exclusion);

  const excludes = (path: string): boolean =>
    required.has(path) === false && matchesOrParentMatches(patterns, path);

  return {
    ignoreFile: ignoreFile?.path ?? null,
    required,
    excludes,
    skipsDirectory: (path) =>
      hasExceptions === false &&
      [...required].some((kept) => kept.startsWith(`${path}/`)) === false &&
      excludes(path),
  };
}

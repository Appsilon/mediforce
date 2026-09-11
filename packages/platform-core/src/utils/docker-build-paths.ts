/**
 * Where a build's Dockerfile and context sit inside the cloned repo.
 *
 * Two shapes, decided by whether a `context` is named:
 *
 * - **No context** — `dockerfile` is a path from the repo root and the build
 *   context is the directory it sits in, so everything it `COPY`s must sit
 *   beside it.
 * - **A context** — docker-compose's contract. `context` is a directory from the
 *   repo root and `dockerfile` is a path from that directory. Naming the repo
 *   root lets `container/Dockerfile` `COPY scripts/`.
 *
 * Plain string logic rather than `node:path`: the catalog view runs this in the
 * browser to link to the Dockerfile an entry names.
 */

import { z } from 'zod';

const DEFAULT_DOCKERFILE = 'Dockerfile';

export interface DockerBuildPaths {
  /** Dockerfile path from the repo root. */
  dockerfile: string;
  /** Build context directory from the repo root; `''` is the root itself. */
  context: string;
}

function hasContext(context: string | undefined): context is string {
  return context !== undefined && context !== '';
}

/**
 * Collapse `.`, `..` and empty segments. `null` when the path climbs above the
 * repo root. A leading `/` is the repo root, as joining it onto the clone
 * directory always made it.
 */
function normalizeRepoPath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join('/');
}

function joinedDockerfile(dockerfile: string | undefined, context: string | undefined): string {
  const file = dockerfile === undefined || dockerfile === '' ? DEFAULT_DOCKERFILE : dockerfile;
  return hasContext(context) ? `${context}/${file}` : file;
}

/**
 * The Dockerfile and context a build hands to `docker build`, both from the
 * repo root. Throws when either leaves the repository — a context of `../..`
 * would otherwise send the build host's own files to the daemon. Only the
 * strings: a symlink in the checkout is the builders' to refuse, since this
 * package never touches a filesystem.
 *
 * The resolved paths are for `-f` and the context argument only. The build
 * labels keep `dockerfile` and `context` as named, because that is what
 * `deriveBuildTag` hashed — labelling the resolved defaults would make an
 * image claim inputs its own tag never saw, and no Image Catalog entry could
 * match it (ADR-0022 decision 1).
 */
export function resolveDockerBuildPaths(
  dockerfile: string | undefined,
  context: string | undefined,
): DockerBuildPaths {
  const resolvedDockerfile = normalizeRepoPath(joinedDockerfile(dockerfile, context));
  if (resolvedDockerfile === null) {
    throw new Error(
      `Dockerfile "${joinedDockerfile(dockerfile, context)}" is outside the repository.`,
    );
  }
  if (hasContext(context) === false) {
    const lastSlash = resolvedDockerfile.lastIndexOf('/');
    return {
      dockerfile: resolvedDockerfile,
      context: lastSlash === -1 ? '' : resolvedDockerfile.slice(0, lastSlash),
    };
  }
  const resolvedContext = normalizeRepoPath(context);
  if (resolvedContext === null) {
    throw new Error(`Build context "${context}" is outside the repository.`);
  }
  return { dockerfile: resolvedDockerfile, context: resolvedContext };
}

/** Whether `resolveDockerBuildPaths` would accept these paths — for a contract
 *  to refuse an escaping path as bad input rather than let a build fail on it. */
export function buildPathsStayInRepo(dockerfile: string | undefined, context: string | undefined): boolean {
  try {
    resolveDockerBuildPaths(dockerfile, context);
    return true;
  } catch {
    return false;
  }
}

/**
 * The Dockerfile an Image Catalog entry is keyed on (ADR-0022 decision 1).
 *
 * Without a context it is `dockerfile` exactly as written, `''` included, so a
 * context-less source keys on the same bytes `deriveBuildTag` and the build
 * label carry. With one it is the path from the repo root, because the key is
 * the file and the context is only how it is built: `Dockerfile` under context
 * `container` and `container/Dockerfile` with no context are one entry.
 *
 * Never throws: it also keys the images read back off the daemon, and one
 * mislabelled image must not fail a catalog read.
 */
export function catalogDockerfileKey(dockerfile: string, context: string | undefined): string {
  if (hasContext(context) === false) return dockerfile;
  const joined = joinedDockerfile(dockerfile, context);
  return normalizeRepoPath(joined) ?? joined;
}

/**
 * One spelling per context directory — `.`, `./` and `/` are all the repo
 * root — so equivalent builds share a tag. Never throws, like
 * `catalogDockerfileKey`: an escaping context is returned as written.
 */
export function normalizeBuildContext(context: string): string {
  return normalizeRepoPath(context) ?? context;
}

/** `repo · dockerfile · context X` — the one line a built source reads as,
 *  in the CLI and the Images view alike. */
export function builtSourceLine(repo: string, dockerfile: string, context: string | undefined): string {
  const dockerfilePart = dockerfile === '' ? '' : ` · ${dockerfile}`;
  const contextPart = hasContext(context) ? ` · context ${context}` : '';
  return `${repo}${dockerfilePart}${contextPart}`;
}

/** A build context as a step or an entry names it: a directory in the repo. */
export const BuildContextSchema = z
  .string()
  .refine((context) => normalizeRepoPath(context) !== null, {
    message: 'context must be a directory inside the repository',
  });

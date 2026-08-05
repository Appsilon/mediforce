import { ValidationError, HandlerError } from '../../errors';

const GITHUB_HOST = 'github.com';
/** A fully-qualified commit SHA (exactly 40 hex chars) — already immutable, so
 *  it needs no resolution round-trip. Shorter refs (branches, tags, abbreviated
 *  SHAs) are resolved via the GitHub API. */
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;

interface ParsedGitHubRepo {
  owner: string;
  name: string;
  pathPrefix: string;
  sourceRef?: string;
  treeSegments?: string[];
}

/** Parse a GitHub repo or tree URL into its API identity and optional path.
 *  Tree URLs scope raw-file requests to a directory within the repository;
 *  slash-containing refs are disambiguated during commit resolution. */
function parseGitHubRepo(repo: string): ParsedGitHubRepo {
  let url: URL;
  try {
    url = new URL(repo);
  } catch {
    throw new ValidationError(`Invalid repo URL: ${repo}`);
  }
  if (url.hostname !== GITHUB_HOST) {
    throw new ValidationError(`Only GitHub repos are supported (got: ${url.hostname})`);
  }
  const segments = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (segments.length === 2) {
    return { owner: segments[0], name: segments[1], pathPrefix: '' };
  }
  if (segments.length >= 5 && segments[2] === 'tree') {
    const treeSegments = segments.slice(3);
    return {
      owner: segments[0],
      name: segments[1],
      pathPrefix: treeSegments.slice(1).join('/'),
      sourceRef: treeSegments[0],
      treeSegments,
    };
  }
  throw new ValidationError(
    `Repo URL must be https://github.com/owner/repo or https://github.com/owner/repo/tree/ref/path (got: ${repo})`,
  );
}

export function buildRawUrl(
  repo: string,
  ref: string | undefined,
  path: string,
  pathPrefixOverride?: string,
): string {
  const { owner, name, pathPrefix, sourceRef } = parseGitHubRepo(repo);
  const resolvedRef = ref || sourceRef || 'main';
  const scopedPath = [pathPrefixOverride ?? pathPrefix, path].filter(Boolean).join('/');
  return `https://raw.githubusercontent.com/${owner}/${name}/${resolvedRef}/${scopedPath}`;
}

/**
 * Fetch JSON from `url`, throwing a `ValidationError` whose message names
 * `label` (e.g. "manifest", "workflow definition") on any non-OK status or
 * network failure. An already-typed `HandlerError` from the request is
 * re-thrown unchanged so callers keep the original status.
 */
export async function fetchJsonOrThrow(url: string, label: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new ValidationError(
        `Failed to fetch ${label}: ${res.status} ${res.statusText} (${url})`,
      );
    }
    return (await res.json()) as unknown;
  } catch (err) {
    if (err instanceof HandlerError) throw err;
    throw new ValidationError(`Failed to fetch ${label}: ${String(err)}`);
  }
}

/**
 * Resolve a ref (branch, tag, or abbreviated/full SHA) to its immutable commit
 * SHA. A full 40-char SHA is returned as-is (no network call). Anything else is
 * resolved via the unauthenticated GitHub API; the `application/vnd.github.sha`
 * media type makes the endpoint return the bare SHA as plain text.
 *
 * Resolution failure is fatal — the caller cannot record reliable provenance
 * without it — with a message distinguishing "ref not found" from "rate
 * limited" so the user knows whether to fix the ref or simply retry.
 */
async function resolveCanonicalCommitSha(repo: string, ref: string): Promise<string> {
  const { owner, name } = parseGitHubRepo(repo);
  const resolvedRef = ref;
  if (FULL_COMMIT_SHA.test(resolvedRef)) return resolvedRef;

  const apiUrl = `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(resolvedRef)}`;

  let res: Response;
  try {
    res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github.sha' } });
  } catch (err) {
    throw new ValidationError(`Failed to resolve commit for ref '${resolvedRef}' in ${repo}: ${String(err)}`);
  }

  if (res.status === 404) {
    throw new ValidationError(`Ref '${resolvedRef}' not found in ${repo}`);
  }
  if (res.status === 403) {
    throw new ValidationError(
      `GitHub rate limit reached while resolving ref '${resolvedRef}' — retry in a few minutes`,
    );
  }
  if (!res.ok) {
    throw new ValidationError(
      `Failed to resolve commit for ref '${resolvedRef}' in ${repo}: ${res.status} ${res.statusText}`,
    );
  }

  const sha = (await res.text()).trim();
  if (!FULL_COMMIT_SHA.test(sha)) {
    throw new ValidationError(`Unexpected commit-resolution response for ref '${resolvedRef}' in ${repo}`);
  }
  return sha;
}

interface ResolvedGitHubSource {
  repo: string;
  ref: string;
  pathPrefix: string;
  commit: string;
}

function canonicalRepoUrl(parsed: ParsedGitHubRepo): string {
  return `https://${GITHUB_HOST}/${parsed.owner}/${parsed.name}`;
}

async function resolveTreeSource(
  parsed: ParsedGitHubRepo,
  canonicalRepo: string,
  requestedRef?: string,
): Promise<Omit<ResolvedGitHubSource, 'repo'>> {
  const treeSegments = parsed.treeSegments!;
  if (requestedRef !== undefined && requestedRef !== '') {
    const requestedSegments = requestedRef.split('/');
    const hasRefPrefix = requestedSegments.every(
      (segment, index) => treeSegments[index] === segment,
    );
    const pathPrefix = treeSegments
      .slice(hasRefPrefix ? requestedSegments.length : 1)
      .join('/');
    return {
      ref: requestedRef,
      pathPrefix,
      commit: await resolveCanonicalCommitSha(canonicalRepo, requestedRef),
    };
  }

  // GitHub tree URLs do not delimit a slash-containing ref from the directory
  // path. Try the longest candidate first so `tree/feat/topic/docs` resolves
  // `feat/topic` as the ref and `docs` as the directory.
  for (let candidateLength = treeSegments.length; candidateLength > 0; candidateLength--) {
    const candidateRef = treeSegments.slice(0, candidateLength).join('/');
    try {
      return {
        ref: candidateRef,
        pathPrefix: treeSegments.slice(candidateLength).join('/'),
        commit: await resolveCanonicalCommitSha(canonicalRepo, candidateRef),
      };
    } catch (err) {
      if (!(err instanceof ValidationError) || !/not found/i.test(err.message)) {
        throw err;
      }
    }
  }

  throw new ValidationError('Unable to resolve a ref from tree URL');
}

export async function resolveGitHubSource(
  repo: string,
  requestedRef?: string,
): Promise<ResolvedGitHubSource> {
  const parsed = parseGitHubRepo(repo);
  const canonicalRepo = canonicalRepoUrl(parsed);
  if (parsed.treeSegments === undefined) {
    const ref = requestedRef || 'main';
    return {
      repo: canonicalRepo,
      ref,
      pathPrefix: '',
      commit: await resolveCanonicalCommitSha(canonicalRepo, ref),
    };
  }

  return {
    repo: canonicalRepo,
    ...(await resolveTreeSource(parsed, canonicalRepo, requestedRef)),
  };
}

export async function resolveCommitSha(repo: string, ref?: string): Promise<string> {
  return (await resolveGitHubSource(repo, ref)).commit;
}

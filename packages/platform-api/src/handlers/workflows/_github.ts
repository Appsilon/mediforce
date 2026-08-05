import { ValidationError, HandlerError } from '../../errors';

const GITHUB_HOST = 'github.com';
/** A fully-qualified commit SHA (exactly 40 hex chars) — already immutable, so
 *  it needs no resolution round-trip. Shorter refs (branches, tags, abbreviated
 *  SHAs) are resolved via the GitHub API. */
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;

/** Parse a GitHub repo or tree URL into its API identity and optional path.
 *  Tree URLs scope raw-file requests to a directory within the repository.
 *  Tree source refs must be a single URL path segment; use a repository URL
 *  plus the separate ref input for refs containing `/`. */
function parseGitHubRepo(repo: string): {
  owner: string;
  name: string;
  pathPrefix: string;
  sourceRef?: string;
} {
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
    return {
      owner: segments[0],
      name: segments[1],
      pathPrefix: segments.slice(4).join('/'),
      sourceRef: segments[3],
    };
  }
  throw new ValidationError(
    `Repo URL must be https://github.com/owner/repo or https://github.com/owner/repo/tree/ref/path (got: ${repo})`,
  );
}

export function buildRawUrl(repo: string, ref: string | undefined, path: string): string {
  const { owner, name, pathPrefix, sourceRef } = parseGitHubRepo(repo);
  const resolvedRef = ref || sourceRef || 'main';
  const scopedPath = [pathPrefix, path].filter(Boolean).join('/');
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
export async function resolveCommitSha(repo: string, ref?: string): Promise<string> {
  const { owner, name, sourceRef } = parseGitHubRepo(repo);
  const resolvedRef = ref || sourceRef || 'main';
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

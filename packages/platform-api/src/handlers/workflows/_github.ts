import { ValidationError, HandlerError } from '../../errors';

const GITHUB_HOST = 'github.com';
/** A fully-qualified commit SHA (exactly 40 hex chars) — already immutable, so
 *  it needs no resolution round-trip. Shorter refs (branches, tags, abbreviated
 *  SHAs) are resolved via the GitHub API. */
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;

/** Parse a canonical `https://github.com/owner/repo` URL into its parts.
 *  Rejects non-GitHub hosts and any URL that is not exactly `/owner/repo`
 *  (e.g. `/org/repo/tree/main`, bare owner). */
function parseGitHubRepo(repo: string): { owner: string; name: string } {
  let url: URL;
  try {
    url = new URL(repo);
  } catch {
    throw new ValidationError(`Invalid repo URL: ${repo}`);
  }
  if (url.hostname !== GITHUB_HOST) {
    throw new ValidationError(`Only GitHub repos are supported (got: ${url.hostname})`);
  }
  // Expect exactly /owner/repo — reject sub-paths like /org/repo/tree/main
  const segments = url.pathname.replace(/\.git$/, '').split('/').filter(Boolean);
  if (segments.length !== 2) {
    throw new ValidationError(`Repo URL must be https://github.com/owner/repo (got: ${repo})`);
  }
  return { owner: segments[0], name: segments[1] };
}

export function buildRawUrl(repo: string, ref: string, path: string): string {
  const { owner, name } = parseGitHubRepo(repo);
  return `https://raw.githubusercontent.com/${owner}/${name}/${ref}/${path}`;
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
export async function resolveCommitSha(repo: string, ref: string): Promise<string> {
  if (FULL_COMMIT_SHA.test(ref)) return ref;

  const { owner, name } = parseGitHubRepo(repo);
  const apiUrl = `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`;

  let res: Response;
  try {
    res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github.sha' } });
  } catch (err) {
    throw new ValidationError(`Failed to resolve commit for ref '${ref}' in ${repo}: ${String(err)}`);
  }

  if (res.status === 404) {
    throw new ValidationError(`Ref '${ref}' not found in ${repo}`);
  }
  if (res.status === 403) {
    throw new ValidationError(
      `GitHub rate limit reached while resolving ref '${ref}' — retry in a few minutes`,
    );
  }
  if (!res.ok) {
    throw new ValidationError(
      `Failed to resolve commit for ref '${ref}' in ${repo}: ${res.status} ${res.statusText}`,
    );
  }

  const sha = (await res.text()).trim();
  if (!FULL_COMMIT_SHA.test(sha)) {
    throw new ValidationError(`Unexpected commit-resolution response for ref '${ref}' in ${repo}`);
  }
  return sha;
}

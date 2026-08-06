import { ValidationError, HandlerError } from '../../errors';

const GITHUB_HOST = 'github.com';
/** A fully-qualified commit SHA (exactly 40 hex chars) — already immutable, so
 *  it needs no resolution round-trip. Shorter refs (branches, tags, abbreviated
 *  SHAs) are resolved via the GitHub API. */
const FULL_COMMIT_SHA = /^[a-f0-9]{40}$/;

/** A GitHub source URL: either the repository itself, or a tree URL whose
 *  segments still mix the ref with the directory it scopes to. Which one it is
 *  decides whether a ref/directory boundary has to be resolved at all. */
type ParsedGitHubRepo =
  | { kind: 'repo'; owner: string; name: string }
  | { kind: 'tree'; owner: string; name: string; treeSegments: string[] };

/** Parse a GitHub repo or tree URL into its API identity and, for a tree URL,
 *  the undivided `<ref>/<directory>` segments — where the ref ends is only
 *  knowable by probing, so the split happens during commit resolution. */
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
    return { kind: 'repo', owner: segments[0], name: segments[1] };
  }
  // Four segments is `owner/repo/tree/<ref>` — the URL GitHub shows for a branch
  // with no subdirectory selected, which scopes to the repository root.
  if (segments.length >= 4 && segments[2] === 'tree') {
    return {
      kind: 'tree',
      owner: segments[0],
      name: segments[1],
      treeSegments: segments.slice(3),
    };
  }
  throw new ValidationError(
    `Repo URL must be https://github.com/owner/repo or https://github.com/owner/repo/tree/ref/path (got: ${repo})`,
  );
}

/** Build a raw.githubusercontent.com URL for `path` under `pathPrefix`. The
 *  repo must be canonical (`https://github.com/owner/repo`) and the ref already
 *  resolved: a tree URL still carries an unsplit ref/directory pair, so
 *  accepting one here would silently pick a wrong prefix. */
export function buildRawUrl(repo: string, ref: string, path: string, pathPrefix = ''): string {
  const parsed = parseGitHubRepo(repo);
  if (parsed.kind === 'tree') {
    throw new ValidationError(
      `Raw URLs must be built from a canonical repo URL, not a tree URL (got: ${repo})`,
    );
  }
  const scopedPath = [pathPrefix, path].filter(Boolean).join('/');
  return `https://raw.githubusercontent.com/${parsed.owner}/${parsed.name}/${ref}/${scopedPath}`;
}

/**
 * Fetch JSON from the first of `urls` that exists, throwing a `ValidationError`
 * whose message names `label` (e.g. "manifest", "workflow definition") when none
 * do. A 404 moves on to the next candidate — that is how an alternative file
 * name is probed — while any other non-OK status or network failure throws
 * immediately, so a rate limit is never mistaken for "not there". An
 * already-typed `HandlerError` from the request is re-thrown unchanged so
 * callers keep the original status.
 */
export async function fetchFirstJson(urls: string[], label: string): Promise<unknown> {
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.status === 404) continue;
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
  throw new ValidationError(`Failed to fetch ${label}: 404 Not Found (${urls[0]})`);
}

export async function fetchJsonOrThrow(url: string, label: string): Promise<unknown> {
  return fetchFirstJson([url], label);
}

/** Statuses GitHub's get-commit endpoint uses for "no such ref": 404 for a ref
 *  it looked up and missed, 422 ("No commit found for SHA") when the ref reads
 *  as a SHA candidate — which is what a slash-containing tree candidate does. */
const REF_MISS_STATUSES = new Set([404, 422]);

/**
 * Look a ref (branch, tag, or abbreviated/full SHA) up to its immutable commit
 * SHA, returning `null` when the ref does not exist. A full 40-char SHA is
 * returned as-is (no network call). Anything else is resolved via the
 * unauthenticated GitHub API; the `application/vnd.github.sha` media type makes
 * the endpoint return the bare SHA as plain text.
 *
 * A missing ref is a return value rather than an exception because probing tree
 * candidates asks "does this ref exist?" on purpose; every other failure (rate
 * limit, network, malformed response) still throws.
 */
async function findCommitSha(repo: string, ref: string): Promise<string | null> {
  const { owner, name } = parseGitHubRepo(repo);
  if (FULL_COMMIT_SHA.test(ref)) return ref;

  const apiUrl = `https://api.github.com/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`;

  let res: Response;
  try {
    res = await fetch(apiUrl, { headers: { Accept: 'application/vnd.github.sha' } });
  } catch (err) {
    throw new ValidationError(`Failed to resolve commit for ref '${ref}' in ${repo}: ${String(err)}`);
  }

  if (REF_MISS_STATUSES.has(res.status)) return null;
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

/**
 * Resolve a ref the caller named explicitly. Failure is fatal — the caller
 * cannot record reliable provenance without a commit — with a message
 * distinguishing "ref not found" from "rate limited" so the user knows whether
 * to fix the ref or simply retry.
 */
async function resolveCanonicalCommitSha(repo: string, ref: string): Promise<string> {
  const sha = await findCommitSha(repo, ref);
  if (sha === null) throw new ValidationError(`Ref '${ref}' not found in ${repo}`);
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

/** GitHub tree URLs do not delimit a slash-containing ref from the directory
 *  path. Probe the longest candidate first so `tree/feat/topic/docs` resolves
 *  `feat/topic` as the ref and `docs` as the directory. `null` means no prefix
 *  of the tree segments names a ref that exists. */
async function resolveTreeBoundary(
  treeSegments: string[],
  canonicalRepo: string,
): Promise<Omit<ResolvedGitHubSource, 'repo'> | null> {
  for (let candidateLength = treeSegments.length; candidateLength > 0; candidateLength--) {
    const ref = treeSegments.slice(0, candidateLength).join('/');
    const commit = await findCommitSha(canonicalRepo, ref);
    if (commit !== null) {
      return { ref, pathPrefix: treeSegments.slice(candidateLength).join('/'), commit };
    }
  }
  return null;
}

async function resolveTreeSource(
  treeSegments: string[],
  canonicalRepo: string,
  requestedRef?: string,
): Promise<Omit<ResolvedGitHubSource, 'repo'>> {
  // Where the ref ends and the directory begins is a property of the URL, so it
  // is resolved before any override is applied — otherwise overriding the ref of
  // `tree/feat/topic/docs` would silently move the directory to `topic/docs`.
  const boundary = await resolveTreeBoundary(treeSegments, canonicalRepo);

  if (requestedRef === undefined || requestedRef === '') {
    if (boundary === null) {
      throw new ValidationError(
        `No branch, tag, or commit in ${canonicalRepo} matches '${treeSegments.join('/')}'`,
      );
    }
    return boundary;
  }
  if (boundary?.ref === requestedRef) return boundary;

  // No candidate resolved, so the URL's own ref is gone and its directory
  // boundary is unknowable. Assume the common single-segment ref, which keeps an
  // import working when the URL pins a deleted branch — but is a guess: for a
  // deleted *slash-containing* ref it picks the wrong directory, and the fetch
  // then 404s rather than importing the wrong file.
  return {
    ref: requestedRef,
    pathPrefix: boundary?.pathPrefix ?? treeSegments.slice(1).join('/'),
    commit: await resolveCanonicalCommitSha(canonicalRepo, requestedRef),
  };
}

export async function resolveGitHubSource(
  repo: string,
  requestedRef?: string,
): Promise<ResolvedGitHubSource> {
  const parsed = parseGitHubRepo(repo);
  const canonicalRepo = canonicalRepoUrl(parsed);
  if (parsed.kind === 'repo') {
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
    ...(await resolveTreeSource(parsed.treeSegments, canonicalRepo, requestedRef)),
  };
}

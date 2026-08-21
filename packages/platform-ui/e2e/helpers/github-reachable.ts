/**
 * Workflow import necessarily talks to github.com — there is no local stand-in
 * for resolving a ref to an immutable commit. Journeys that exercise it probe
 * once in `beforeAll` and self-skip with a diagnostic: a transport failure or a
 * 403 (GitHub rate limit) reads as "not available here", not as a product
 * defect.
 */

/** Resolves a ref to a commit — every import path needs it. */
export const GITHUB_API_PROBE = 'https://api.github.com/repos/Appsilon/mediforce/commits/main';
/** The manifest the browse flow lists; published only once it lands on `main`. */
export const MANIFEST_PROBE =
  'https://raw.githubusercontent.com/Appsilon/mediforce/main/workflows-index.json';

export interface GitHubReachability {
  apiReachable: boolean;
  manifestPublished: boolean;
}

async function isAvailable(url: string): Promise<boolean> {
  try {
    return (await fetch(url)).ok;
  } catch {
    return false;
  }
}

export async function probeGitHub(): Promise<GitHubReachability> {
  const apiReachable = await isAvailable(GITHUB_API_PROBE);
  return {
    apiReachable,
    manifestPublished: apiReachable && (await isAvailable(MANIFEST_PROBE)),
  };
}

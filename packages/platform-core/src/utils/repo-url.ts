/**
 * Repository reference → clone transport resolution.
 *
 * Pure string helpers, no git or filesystem access, so both the agent-runtime
 * clone paths (skills fetch, lazy image build) and the container-worker copy
 * decide the same transport for the same reference.
 */

export interface RepoCloneTarget {
  cloneUrl: string;
  /** Clone needs a deploy key via `GIT_SSH_COMMAND`. */
  useSsh: boolean;
}

/** Normalize a repo reference to SSH clone URL and HTTPS browsable URL.
 *  Supports: "org/repo", "git@github.com:org/repo.git", "https://github.com/org/repo", "/path/to/bare.git" */
export function normalizeRepoUrls(repo: string): { gitUrl: string; httpsUrl: string } {
  if (repo.startsWith('/') || repo.startsWith('.')) {
    return { gitUrl: repo, httpsUrl: '' };
  }
  if (repo.startsWith('git@')) {
    const match = repo.match(/git@github\.com:(.+?)(?:\.git)?$/);
    const orgRepo = match ? match[1] : repo;
    return { gitUrl: repo, httpsUrl: `https://github.com/${orgRepo}` };
  }
  if (repo.startsWith('https://')) {
    const clean = repo.replace(/\.git$/, '');
    const match = clean.match(/https:\/\/github\.com\/(.+)/);
    const sshUrl = match ? `git@github.com:${match[1]}.git` : `${clean}.git`;
    return { gitUrl: sshUrl, httpsUrl: clean };
  }
  return {
    gitUrl: `git@github.com:${repo}.git`,
    httpsUrl: `https://github.com/${repo}`,
  };
}

/** Convert SSH git URL to HTTPS with token for authenticated clone. */
export function toHttpsWithToken(sshUrl: string, token: string): string {
  const match = sshUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) {
    return `https://x-access-token:${token}@github.com/${match[1]}.git`;
  }
  return sshUrl.replace('https://', `https://x-access-token:${token}@`);
}

/** Remove repository credentials from messages that may be surfaced to users. */
export function redactRepoCredentials(value: string, repoToken?: string): string {
  const tokenRedacted = repoToken ? value.split(repoToken).join('[REDACTED]') : value;
  return tokenRedacted.replace(/(https?:\/\/)[^/\s@]+@/g, '$1[REDACTED]@');
}

/**
 * Clone attempts for a repo reference, in the order they should be tried. The
 * first entry is the transport the reference asks for; a second entry only
 * appears where the preferred transport cannot decide access on its own.
 *
 *   - token present  → authenticated HTTPS (`x-access-token`); a PAT only works
 *                      over HTTPS, mirroring the main-repo clone path. A host
 *                      the token converter doesn't understand keeps SSH so a
 *                      configured deploy key still applies.
 *   - `git@…`        → SSH as given (needs deploy key + `GIT_SSH_COMMAND`)
 *   - local path     → as given
 *   - `owner/repo` shorthand / `https://…` → anonymous HTTPS first, so a public
 *                      repo clones with no credentials at all; a private one
 *                      answers 404 there, so SSH with the deploy key follows.
 */
export function resolveRepoCloneTargets(repoRef: string, repoToken?: string): RepoCloneTarget[] {
  if (repoRef.startsWith('/') || repoRef.startsWith('.')) {
    return [{ cloneUrl: repoRef, useSsh: false }];
  }
  if (repoToken) {
    const tokenUrl = toHttpsWithToken(normalizeRepoUrls(repoRef).gitUrl, repoToken);
    return tokenUrl.startsWith('https://')
      ? [{ cloneUrl: tokenUrl, useSsh: false }]
      : [{ cloneUrl: repoRef, useSsh: true }];
  }
  if (repoRef.startsWith('git@')) {
    return [{ cloneUrl: repoRef, useSsh: true }];
  }
  const { gitUrl, httpsUrl } = normalizeRepoUrls(repoRef);
  const targets: RepoCloneTarget[] = [
    { cloneUrl: repoRef.startsWith('https://') ? repoRef : httpsUrl, useSsh: false },
  ];
  if (gitUrl.startsWith('git@')) {
    targets.push({ cloneUrl: gitUrl, useSsh: true });
  }
  return targets;
}

import { allowedRepoHosts, repoHost } from '@mediforce/platform-core';
import { ValidationError } from '../errors';

/**
 * Refuse any repository this deployment will not clone on a caller's behalf.
 *
 * Two distinct dangers, both closed here:
 *
 *  - A reference beginning `/` or `.` is cloned from the local filesystem by
 *    `resolveRepoCloneTargets`, which would make this endpoint a reader for the
 *    API server's own disk.
 *  - Any other host receives `repoAuth` as basic auth in the clone URL. Since a
 *    workflow author may write a secret but never read one, an unrestricted
 *    host is a way to exfiltrate one: point `repo` at a machine you control and
 *    read the token out of your own logs.
 */
export function assertClonableRepo(repo: string): void {
  if (repo.startsWith('/') || repo.startsWith('.')) {
    throw new ValidationError(
      `Repository '${repo}' is a local filesystem path. Only a remote repository can be previewed.`,
    );
  }
  const host = repoHost(repo);
  const allowed = allowedRepoHosts(process.env.MEDIFORCE_REPO_HOSTS);
  if (host === null || allowed.includes(host) === false) {
    throw new ValidationError(
      `Repository '${repo}' is not on a host this deployment previews from (${allowed.join(', ')}).`,
    );
  }
}

/**
 * Shallow clone of a repo at one commit, shared by the skills fetch and the
 * lazy image build so both pick the same transport and the same deploy key.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { redactRepoCredentials, resolveRepoCloneTargets } from '@mediforce/platform-core';

let preparedDeployKeyPath: string | null = null;

/**
 * Returns a deploy-key path that ssh will accept — copies the configured key
 * to a private tmp file with 0600 perms so host-side mount modes can't break us.
 *
 * NOTE: Keep in sync with the duplicated copy in
 * `packages/container-worker/src/docker-image-builder.ts` — container-worker cannot
 * import from agent-runtime without dragging in its whole dependency tree.
 */
export function prepareDeployKeyPath(): string {
  const source = process.env.DEPLOY_KEY_PATH ?? join(homedir(), '.ssh', 'deploy_key');
  if (!existsSync(source)) return source;
  if (!statSync(source).isFile()) {
    throw new Error(`Deploy key path "${source}" must point to a regular file.`);
  }
  if (preparedDeployKeyPath && existsSync(preparedDeployKeyPath) && statSync(preparedDeployKeyPath).isFile()) return preparedDeployKeyPath;
  const dir = mkdtempSync(join(tmpdir(), 'mediforce-ssh-'));
  const dest = join(dir, 'deploy_key');
  copyFileSync(source, dest);
  chmodSync(dest, 0o600);
  preparedDeployKeyPath = dest;
  return dest;
}

export function getGitSshCommand(): string {
  return `ssh -i ${prepareDeployKeyPath()} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`;
}

/**
 * Fetch `commit` from `repoRef` into `targetDir` (already-existing directory),
 * trying each transport the reference resolves to (order and fallbacks:
 * {@link resolveRepoCloneTargets}).
 */
export function cloneRepoAtCommit(
  targetDir: string,
  repoRef: string,
  commit: string,
  repoToken?: string,
  options?: {
    /** Caps a fetch triggered by a request rather than by a run, where an
     *  arbitrary repository could otherwise hold the caller open indefinitely. */
    readonly timeoutMs?: number;
    /**
     * Fetch the commit's trees but none of its file contents, and do not check
     * out, leaving `FETCH_HEAD` rather than a working tree. Listing then costs
     * the directory structure rather than every byte the repository holds, and
     * `git show` fetches a single blob when somebody opens that one file.
     */
    readonly treeless?: boolean;
    /**
     * Only try transports that carry no credential of ours. The deploy key
     * reaches private repositories the caller may have no claim to, so a read
     * the caller can trigger for an arbitrary repository must not use it.
     */
    readonly anonymousOnly?: boolean;
  },
): void {
  const resolved = resolveRepoCloneTargets(repoRef, repoToken);
  const targets = options?.anonymousOnly === true
    ? resolved.filter((target) => target.useSsh === false)
    : resolved;
  if (targets.length === 0) {
    throw new Error(
      `'${redactRepoCredentials(repoRef, repoToken)}' can only be reached with this deployment's own key, which is not used for this read.`,
    );
  }
  const failures: { transport: string; message: string }[] = [];

  execFileSync('git', ['init', targetDir], { stdio: 'pipe' });

  for (const { cloneUrl, useSsh } of targets) {
    try {
      // SSH refs need a deploy key + GIT_SSH_COMMAND; HTTPS and local paths must not set it.
      // Prompts are disabled so a private repo fails fast on the anonymous attempt
      // instead of blocking on a credential read. Reading the deploy key happens inside
      // the try so a broken key surfaces alongside the earlier transport's failure.
      const execOpts = {
        stdio: 'pipe' as const,
        ...(options?.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
        env: useSsh
          ? { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: getGitSshCommand() }
          : { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      };

      // A throwaway clone never needs maintenance, and the detached run `git
      // fetch` starts would still be writing into it while it is removed.
      const fetchArgs = [
        '-C', targetDir, '-c', 'maintenance.auto=false',
        'fetch', cloneUrl, commit, '--depth', '1',
      ];
      if (options?.treeless === true) fetchArgs.push('--filter=blob:none');
      execFileSync('git', fetchArgs, execOpts);
      // The fetch itself records the promisor remote, keyed on the URL, which
      // is what a later `git show` lazy-fetches a blob through. Naming a second
      // `origin` remote adds nothing and would write the credentialed URL into
      // the checkout's own config.
      if (options?.treeless === true) return;
      execFileSync('git', ['-C', targetDir, 'checkout', 'FETCH_HEAD'], execOpts);
      return;
    } catch (error) {
      failures.push({
        transport: useSsh ? 'SSH' : 'HTTPS',
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn(
        `[git-clone] ${useSsh ? 'SSH' : 'HTTPS'} fetch of ${redactRepoCredentials(repoRef, repoToken)}@${commit.slice(0, 8)} failed`,
      );
    }
  }

  const transports = failures.map(({ transport }) => transport).join(' then ');
  const safeRepoRef = redactRepoCredentials(repoRef, repoToken);
  // Every attempt's cause, not just the last: with SSH tried first, the last is
  // HTTPS, and it would hide the deploy-key error that explains the failure.
  const causes = failures.length === 1
    ? failures[0].message
    : failures.map(({ transport, message }) => `${transport}: ${message}`).join('; ');
  throw new Error(
    `Failed to fetch ${safeRepoRef}@${commit.slice(0, 8)} over ${transports}: ${redactRepoCredentials(causes, repoToken)}`,
  );
}

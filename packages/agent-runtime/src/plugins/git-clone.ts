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
 * trying each transport the reference resolves to. Anonymous HTTPS is tried
 * before the SSH deploy key for shorthand and HTTPS references, so a public
 * repo needs no credentials and a private one still reaches its deploy key.
 */
export function cloneRepoAtCommit(
  targetDir: string,
  repoRef: string,
  commit: string,
  repoToken?: string,
): void {
  const targets = resolveRepoCloneTargets(repoRef, repoToken);
  let lastError: unknown;

  execFileSync('git', ['init', targetDir], { stdio: 'pipe' });

  for (const { cloneUrl, useSsh } of targets) {
    try {
      // SSH refs need a deploy key + GIT_SSH_COMMAND; HTTPS and local paths must not set it.
      // Prompts are disabled so a private repo fails fast on the anonymous attempt
      // instead of blocking on a credential read. Reading the deploy key happens inside
      // the try so a broken key surfaces alongside the earlier transport's failure.
      const execOpts = {
        stdio: 'pipe' as const,
        env: useSsh
          ? { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: getGitSshCommand() }
          : { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      };

      execFileSync('git', ['-C', targetDir, 'fetch', cloneUrl, commit, '--depth', '1'], execOpts);
      execFileSync('git', ['-C', targetDir, 'checkout', 'FETCH_HEAD'], execOpts);
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `[git-clone] ${useSsh ? 'SSH' : 'HTTPS'} fetch of ${redactRepoCredentials(repoRef, repoToken)}@${commit.slice(0, 8)} failed`,
      );
    }
  }

  const transports = targets.map(({ useSsh }) => (useSsh ? 'SSH' : 'HTTPS')).join(' then ');
  const safeRepoRef = redactRepoCredentials(repoRef, repoToken);
  const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to fetch ${safeRepoRef}@${commit.slice(0, 8)} over ${transports}: ${redactRepoCredentials(lastErrorMessage, repoToken)}`,
  );
}

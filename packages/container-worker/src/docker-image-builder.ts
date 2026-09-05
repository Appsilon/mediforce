/**
 * Lazy Docker image builder for the BullMQ worker.
 *
 * Lightweight copy of agent-runtime/plugins/docker-image-builder.ts.
 * Duplicated to avoid pulling agent-runtime into container-worker.
 */
import { execFileSync, execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import {
  BUILD_LABELS,
  buildProvenanceLabelArgs,
  redactRepoCredentials,
  resolveRepoCloneTargets,
} from '@mediforce/platform-core';

const BUILD_COMMIT_LABEL = BUILD_LABELS.commit;

let preparedDeployKeyPath: string | null = null;

/**
 * NOTE: Keep in sync with the exported copy in
 * `packages/agent-runtime/src/plugins/git-clone.ts`.
 * Duplicated so container-worker stays free of agent-runtime deps.
 */
function prepareDeployKeyPath(): string {
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

function getGitSshCommand(): string {
  return `ssh -i ${prepareDeployKeyPath()} -o StrictHostKeyChecking=no -o IdentitiesOnly=yes`;
}

export async function imageExistsLocally(image: string): Promise<boolean> {
  try {
    execSync(`docker image inspect "${image}"`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function getImageBuildCommit(image: string): Promise<string | null> {
  try {
    const output = execSync(
      `docker inspect --format '{{index .Config.Labels "${BUILD_COMMIT_LABEL}"}}' "${image}"`,
      { stdio: 'pipe' },
    ).toString().trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Fetch `commit` from `repoRef` into `targetDir`, trying each transport the
 * reference resolves to. Mirrors `cloneRepoAtCommit` in
 * `packages/agent-runtime/src/plugins/git-clone.ts`; the transport decision
 * itself is shared via `@mediforce/platform-core`.
 */
function cloneRepoAtCommit(
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
        `[docker-image-builder] ${useSsh ? 'SSH' : 'HTTPS'} fetch of ${redactRepoCredentials(repoRef, repoToken)}@${commit.slice(0, 8)} failed`,
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

export async function buildImageFromRepo(options: {
  image: string;
  repoUrl: string;
  /** Pre-normalization repo reference used to pick the clone transport. Defaults to `repoUrl`. */
  repoRef?: string;
  commit: string;
  dockerfile?: string;
  repoToken?: string;
  /** Workflow definition whose step triggered this build. Recorded as a label. */
  workflow?: string;
  /** Namespace owning that definition. Recorded as a label. */
  namespace?: string;
}): Promise<void> {
  const { image, repoUrl, commit, dockerfile = 'Dockerfile', repoToken, workflow, namespace } = options;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    cloneRepoAtCommit(buildDir, options.repoRef ?? repoUrl, commit, repoToken);

    const dockerfilePath = join(buildDir, dockerfile);
    const buildContext = dirname(dockerfilePath);
    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    // argv form, not a shell string: the label values carry a repo URL, a
    // workflow name and a namespace, none of which are safe to interpolate.
    execFileSync(
      'docker',
      [
        'build',
        '-t', image,
        ...buildProvenanceLabelArgs({ repoUrl, commit, dockerfile, workflow, namespace, repoToken }),
        '-f', dockerfilePath,
        buildContext,
      ],
      { stdio: 'pipe' },
    );
    console.log(`[docker-image-builder] Image "${image}" built successfully`);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

export async function ensureImage(options: {
  image: string;
  repoUrl?: string;
  repoRef?: string;
  commit?: string;
  dockerfile?: string;
  repoToken?: string;
  workflow?: string;
  namespace?: string;
}): Promise<void> {
  const { image, repoUrl, repoRef, commit, dockerfile, repoToken, workflow, namespace } = options;

  if (!repoUrl || !commit) {
    const exists = await imageExistsLocally(image);
    if (exists) return;
    throw new Error(
      `Docker image "${image}" not found locally and no repo+commit configured for auto-build.`,
    );
  }

  const exists = await imageExistsLocally(image);
  if (exists) {
    const currentCommit = await getImageBuildCommit(image);
    if (currentCommit === commit) {
      console.log(`[docker-image-builder] Image "${image}" up-to-date (commit ${commit.slice(0, 8)})`);
      return;
    }
    console.log(`[docker-image-builder] Image "${image}" stale (${currentCommit?.slice(0, 8)} → ${commit.slice(0, 8)}), rebuilding`);
  }

  await buildImageFromRepo({ image, repoUrl, repoRef, commit, dockerfile, repoToken, workflow, namespace });
}

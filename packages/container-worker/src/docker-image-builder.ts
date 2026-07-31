/**
 * Lazy Docker image builder for the BullMQ worker.
 *
 * Lightweight copy of agent-runtime/plugins/docker-image-builder.ts.
 * Duplicated to avoid pulling agent-runtime into container-worker.
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const BUILD_COMMIT_LABEL = 'mediforce.build.commit';

let preparedDeployKeyPath: string | null = null;

/**
 * NOTE: Keep in sync with the exported copy in
 * `packages/agent-runtime/src/plugins/container-plugin.ts`.
 * Duplicated so container-worker stays free of agent-runtime deps.
 */
function prepareDeployKeyPath(): string {
  const source = process.env.DEPLOY_KEY_PATH ?? join(homedir(), '.ssh', 'deploy_key');
  if (!existsSync(source) || !statSync(source).isFile()) return source;
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

function toHttpsWithToken(sshUrl: string, token: string): string {
  const match = sshUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) {
    return `https://x-access-token:${token}@github.com/${match[1]}.git`;
  }
  return sshUrl.replace('https://', `https://x-access-token:${token}@`);
}

/** Normalize a repo reference to SSH clone URL and HTTPS browsable URL.
 *  NOTE: Keep in sync with the exported copy in
 *  `packages/agent-runtime/src/plugins/container-plugin.ts`. */
function normalizeRepoUrls(repo: string): { gitUrl: string; httpsUrl: string } {
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

/**
 * Resolve the clone URL + transport for a repo reference, honouring the form
 * the user supplied. NOTE: Keep in sync with the exported `resolveRepoCloneUrl`
 * in `packages/agent-runtime/src/plugins/container-plugin.ts`.
 *
 *   - token present  → authenticated HTTPS (`x-access-token`)
 *   - `git@…`        → SSH as given (needs deploy key + `GIT_SSH_COMMAND`)
 *   - `https://…` / local path → HTTPS / local as given
 *   - `owner/repo` shorthand   → anonymous HTTPS (github default)
 */
function resolveRepoCloneUrl(
  repoRef: string,
  repoToken?: string,
): { cloneUrl: string; useSsh: boolean } {
  if (repoToken) {
    return { cloneUrl: toHttpsWithToken(normalizeRepoUrls(repoRef).gitUrl, repoToken), useSsh: false };
  }
  if (repoRef.startsWith('git@')) {
    return { cloneUrl: repoRef, useSsh: true };
  }
  if (repoRef.startsWith('https://') || repoRef.startsWith('/') || repoRef.startsWith('.')) {
    return { cloneUrl: repoRef, useSsh: false };
  }
  return { cloneUrl: normalizeRepoUrls(repoRef).httpsUrl, useSsh: false };
}

export async function buildImageFromRepo(options: {
  image: string;
  repoUrl: string;
  /** Pre-normalization repo reference used to pick the clone transport. Defaults to `repoUrl`. */
  repoRef?: string;
  commit: string;
  dockerfile?: string;
  repoToken?: string;
}): Promise<void> {
  const { image, repoUrl, commit, dockerfile = 'Dockerfile', repoToken } = options;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    const { cloneUrl, useSsh } = resolveRepoCloneUrl(options.repoRef ?? repoUrl, repoToken);
    // SSH refs need a deploy key + GIT_SSH_COMMAND; HTTPS / local clones must not set it —
    // a public repo cloned anonymously never references the deploy key.
    const execOpts = {
      stdio: 'pipe' as const,
      env: useSsh ? { ...process.env, GIT_SSH_COMMAND: getGitSshCommand() } : { ...process.env },
    };

    execSync(`git init "${buildDir}"`, execOpts);
    execSync(`git -C "${buildDir}" remote add origin "${cloneUrl}"`, execOpts);
    execSync(`git -C "${buildDir}" fetch origin "${commit}" --depth 1`, execOpts);
    execSync(`git -C "${buildDir}" checkout FETCH_HEAD`, execOpts);

    const dockerfilePath = join(buildDir, dockerfile);
    const buildContext = dirname(dockerfilePath);
    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    execSync(
      `docker build -t "${image}" --label "${BUILD_COMMIT_LABEL}=${commit}" -f "${dockerfilePath}" "${buildContext}"`,
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
}): Promise<void> {
  const { image, repoUrl, repoRef, commit, dockerfile, repoToken } = options;

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

  await buildImageFromRepo({ image, repoUrl, repoRef, commit, dockerfile, repoToken });
}

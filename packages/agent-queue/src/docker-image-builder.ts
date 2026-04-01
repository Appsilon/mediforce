/**
 * Lazy Docker image builder for the BullMQ worker.
 *
 * Lightweight copy of agent-runtime/plugins/docker-image-builder.ts.
 * Duplicated to avoid pulling agent-runtime (and Firebase) into agent-queue.
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir, homedir } from 'node:os';

const BUILD_COMMIT_LABEL = 'mediforce.build.commit';

function getGitSshCommand(): string {
  const deployKeyPath = process.env.DEPLOY_KEY_PATH ?? join(homedir(), '.ssh', 'deploy_key');
  return `ssh -i ${deployKeyPath} -o StrictHostKeyChecking=no`;
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

export async function buildImageFromRepo(options: {
  image: string;
  repoUrl: string;
  commit: string;
  dockerfile?: string;
  repoToken?: string;
}): Promise<void> {
  const { image, repoUrl, commit, dockerfile = 'Dockerfile', repoToken } = options;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    const cloneUrl = repoToken ? toHttpsWithToken(repoUrl, repoToken) : repoUrl;
    const execOpts = {
      stdio: 'pipe' as const,
      env: { ...process.env, GIT_SSH_COMMAND: getGitSshCommand() },
    };

    execSync(`git init "${buildDir}"`, execOpts);
    execSync(`git -C "${buildDir}" remote add origin "${cloneUrl}"`, execOpts);
    execSync(`git -C "${buildDir}" fetch origin ${commit} --depth 1`, execOpts);
    execSync(`git -C "${buildDir}" checkout FETCH_HEAD`, execOpts);

    const dockerfilePath = join(buildDir, dockerfile);
    const buildContext = dirname(dockerfilePath);
    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    execSync(
      `docker build -t "${image}" --label ${BUILD_COMMIT_LABEL}=${commit} -f "${dockerfilePath}" "${buildContext}"`,
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
  commit?: string;
  dockerfile?: string;
  repoToken?: string;
}): Promise<void> {
  const { image, repoUrl, commit, dockerfile, repoToken } = options;

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

  await buildImageFromRepo({ image, repoUrl, commit, dockerfile, repoToken });
}

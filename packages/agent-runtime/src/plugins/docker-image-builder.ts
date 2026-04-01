/**
 * Lazy Docker image builder.
 *
 * Checks whether a Docker image exists locally and, if not, builds it from
 * a git repo at a specific commit. Labels the image with the commit SHA so
 * subsequent runs can detect staleness and rebuild when the commit changes.
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';

export interface BuildImageOptions {
  image: string;
  repoUrl: string;
  commit: string;
  dockerfile?: string;
  repoToken?: string;
}

export interface EnsureImageOptions {
  image: string;
  repoUrl?: string;
  commit?: string;
  dockerfile?: string;
  repoToken?: string;
}

const BUILD_COMMIT_LABEL = 'mediforce.build.commit';

/** In-process mutex to avoid concurrent builds of the same image. */
const buildLocks = new Map<string, Promise<void>>();

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

/** Convert SSH git URL to HTTPS with token for authenticated clone. */
function toHttpsWithToken(sshUrl: string, token: string): string {
  const match = sshUrl.match(/git@github\.com:(.+?)(?:\.git)?$/);
  if (match) {
    return `https://x-access-token:${token}@github.com/${match[1]}.git`;
  }
  return sshUrl.replace('https://', `https://x-access-token:${token}@`);
}

export async function buildImageFromRepo(options: BuildImageOptions): Promise<void> {
  const { image, repoUrl, commit, dockerfile = 'Dockerfile', repoToken } = options;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    const cloneUrl = repoToken ? toHttpsWithToken(repoUrl, repoToken) : repoUrl;
    const execOpts = {
      stdio: 'pipe' as const,
      env: { ...process.env, GIT_SSH_COMMAND: getGitSshCommand() },
    };

    // Clone repo at specific commit (sparse — fetch only what we need)
    execSync(`git init "${buildDir}"`, execOpts);
    execSync(`git -C "${buildDir}" remote add origin "${cloneUrl}"`, execOpts);
    execSync(`git -C "${buildDir}" fetch origin ${commit} --depth 1`, execOpts);
    execSync(`git -C "${buildDir}" checkout FETCH_HEAD`, execOpts);

    // Build image with commit label for stale detection
    const dockerfilePath = join(buildDir, dockerfile);
    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    execSync(
      `docker build -t "${image}" --label ${BUILD_COMMIT_LABEL}=${commit} -f "${dockerfilePath}" "${buildDir}"`,
      { stdio: 'pipe' },
    );
    console.log(`[docker-image-builder] Image "${image}" built successfully`);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

export async function ensureImage(options: EnsureImageOptions): Promise<void> {
  const { image, repoUrl, commit, dockerfile, repoToken } = options;

  // If repo+commit not provided, just check existence
  if (!repoUrl || !commit) {
    const exists = await imageExistsLocally(image);
    if (exists) return;
    throw new Error(
      `Docker image "${image}" not found locally and no repo+commit configured for auto-build. ` +
      'Either pull/build the image manually, or set repo and commit in the workflow step agent config.',
    );
  }

  // Check if existing lock for this image
  const existingLock = buildLocks.get(image);
  if (existingLock) {
    await existingLock;
    return;
  }

  const buildPromise = (async () => {
    try {
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
    } finally {
      buildLocks.delete(image);
    }
  })();

  buildLocks.set(image, buildPromise);
  await buildPromise;
}

/**
 * Lazy Docker image builder.
 *
 * Two build sources. A git repo at a commit: cloned into a temp dir, labelled
 * with the SHA so a later run detects staleness and rebuilds. Or a directory
 * that already exists on the host — the materialized files a workflow carries,
 * written for the `/artifacts` mount — which needs no clone, and whose tag is
 * derived from the files' content so an existing image with that tag was built
 * from exactly those files.
 */
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { cloneRepoAtCommit } from './git-clone';

export interface BuildImageOptions {
  image: string;
  repoUrl: string;
  /** Pre-normalization repo reference used to pick the clone transport. Defaults to `repoUrl`. */
  repoRef?: string;
  commit: string;
  dockerfile?: string;
  repoToken?: string;
}

export interface EnsureImageOptions {
  image: string;
  repoUrl?: string;
  repoRef?: string;
  commit?: string;
  dockerfile?: string;
  repoToken?: string;
  /** Host directory to build from, instead of a clone. The files a workflow
   *  carries, already materialized for the `/artifacts` mount. */
  contextDir?: string;
}

const BUILD_COMMIT_LABEL = 'mediforce.build.commit';


/** In-process mutex to avoid concurrent builds of the same image. */
const buildLocks = new Map<string, Promise<void>>();

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

export async function buildImageFromRepo(options: BuildImageOptions): Promise<void> {
  const { image, repoUrl, commit, dockerfile = 'Dockerfile', repoToken } = options;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    // Clone repo at specific commit (sparse — fetch only what we need)
    cloneRepoAtCommit(buildDir, options.repoRef ?? repoUrl, commit, repoToken);

    // Build image — use the Dockerfile's directory as build context so COPY paths work naturally
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

/**
 * Build from a directory that is already on the host. The build context is the
 * whole directory rather than the Dockerfile's own, so `COPY scripts/ /scripts/`
 * from a `container/Dockerfile` works the way it does in a repository.
 */
export async function buildImageFromDirectory(options: {
  image: string;
  contextDir: string;
  dockerfile?: string;
}): Promise<void> {
  const { image, contextDir, dockerfile = 'Dockerfile' } = options;
  const dockerfilePath = join(contextDir, dockerfile);
  console.log(`[docker-image-builder] Building image "${image}" from ${contextDir}`);
  execSync(
    `docker build -t "${image}" -f "${dockerfilePath}" "${contextDir}"`,
    { stdio: 'pipe' },
  );
  console.log(`[docker-image-builder] Image "${image}" built successfully`);
}

export async function ensureImage(options: EnsureImageOptions): Promise<void> {
  const { image, repoUrl, repoRef, commit, dockerfile, repoToken, contextDir } = options;

  // A directory the caller already has: the tag is derived from the content of
  // the files in it, so an image that exists under this tag was built from
  // exactly them and there is no staleness question to ask.
  if (contextDir !== undefined) {
    const existingLock = buildLocks.get(image);
    if (existingLock) {
      await existingLock;
      return;
    }
    const buildPromise = (async () => {
      try {
        if (await imageExistsLocally(image)) {
          console.log(`[docker-image-builder] Image "${image}" already built from these files`);
          return;
        }
        await buildImageFromDirectory({ image, contextDir, dockerfile });
      } finally {
        buildLocks.delete(image);
      }
    })();
    buildLocks.set(image, buildPromise);
    await buildPromise;
    return;
  }

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

      await buildImageFromRepo({ image, repoUrl, repoRef, commit, dockerfile, repoToken });
    } finally {
      buildLocks.delete(image);
    }
  })();

  buildLocks.set(image, buildPromise);
  await buildPromise;
}

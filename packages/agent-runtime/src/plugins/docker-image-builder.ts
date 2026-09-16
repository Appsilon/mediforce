/**
 * Lazy Docker image builder.
 *
 * Two build sources. A git repo at a commit: cloned into a temp dir, labelled
 * with the SHA so a later run detects staleness and rebuilds. Or a directory
 * that already exists on the host — the materialized files a workflow carries,
 * written for the `/artifacts` mount — which needs no clone, and is labelled
 * with the files' content hash so a later run detects an edit the same way.
 */
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BUILD_LABELS,
  buildProvenanceLabelArgs,
  carriedImageLabelArgs,
  resolveCarriedBuildPaths,
  resolveDockerBuildPaths,
} from '@mediforce/platform-core';
import { cloneRepoAtCommit } from './git-clone';

export interface BuildImageOptions {
  image: string;
  repoUrl: string;
  /** Pre-normalization repo reference used to pick the clone transport. Defaults to `repoUrl`. */
  repoRef?: string;
  commit: string;
  dockerfile?: string;
  /** Build context from the repo root; `dockerfile` is then read from it. */
  context?: string;
  repoToken?: string;
  /** Workflow definition whose step triggered this build. Recorded as a label. */
  workflow?: string;
  /** Namespace owning that definition. Recorded as a label. */
  namespace?: string;
}

export interface EnsureImageOptions {
  image: string;
  repoUrl?: string;
  repoRef?: string;
  commit?: string;
  dockerfile?: string;
  context?: string;
  repoToken?: string;
  /** Host directory to build from, instead of a clone. The files a workflow
   *  carries, already materialized for the `/artifacts` mount. */
  contextDir?: string;
  /** Content hash of the files in `contextDir`, labelled on the image. */
  artifactsHash?: string;
  workflow?: string;
  namespace?: string;
}

const BUILD_COMMIT_LABEL = BUILD_LABELS.commit;


/** In-process mutex to avoid concurrent builds of the same image. */
const buildLocks = new Map<string, Promise<void>>();

// argv form, not a shell string: a step may name its own image, and that name
// is workflow config.
export async function imageExistsLocally(image: string): Promise<boolean> {
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

export async function getImageBuildCommit(image: string): Promise<string | null> {
  return getImageBuildLabel(image, BUILD_COMMIT_LABEL);
}

async function getImageBuildLabel(image: string, key: string): Promise<string | null> {
  try {
    const output = execFileSync(
      'docker',
      ['inspect', '--format', `{{index .Config.Labels "${key}"}}`, image],
      { stdio: 'pipe' },
    ).toString().trim();
    return output.length > 0 ? output : null;
  } catch {
    return null;
  }
}

/**
 * Refuse a build path the checkout resolves outside the clone.
 * `resolveDockerBuildPaths` already refused `..` in the strings; this catches a
 * symlink committed to the repo, which `docker build` follows — a context of
 * `ctx -> /` would otherwise send the build host's filesystem, deploy key
 * included, to the daemon and into an image.
 */
export function assertInsideClone(cloneDir: string, relativePath: string): void {
  const root = realpathSync(cloneDir);
  let resolved: string;
  try {
    resolved = realpathSync(join(cloneDir, relativePath));
  } catch {
    // Missing: there is nothing to escape through, and `docker build` names
    // the missing path itself.
    return;
  }
  if (resolved !== root && resolved.startsWith(`${root}${sep}`) === false) {
    throw new Error(`Build path "${relativePath}" resolves outside the repository.`);
  }
}

export async function buildImageFromRepo(options: BuildImageOptions): Promise<void> {
  const { image, repoUrl, commit, context, repoToken, workflow, namespace } = options;
  // Resolved for `-f` and the context; the labels keep the inputs as named,
  // which is what `deriveBuildTag` hashed (see `resolveDockerBuildPaths`).
  const paths = resolveDockerBuildPaths(options.dockerfile, context);
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    // Clone repo at specific commit (sparse — fetch only what we need)
    cloneRepoAtCommit(buildDir, options.repoRef ?? repoUrl, commit, repoToken);
    assertInsideClone(buildDir, paths.context);
    assertInsideClone(buildDir, paths.dockerfile);

    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    // argv form, not a shell string: the label values carry a repo URL, a
    // workflow name and a namespace, none of which are safe to interpolate.
    execFileSync(
      'docker',
      [
        'build',
        '-t', image,
        ...buildProvenanceLabelArgs({ repoUrl, commit, dockerfile: options.dockerfile ?? '', context, workflow, namespace, repoToken }),
        '-f', join(buildDir, paths.dockerfile),
        join(buildDir, paths.context),
      ],
      { stdio: 'pipe' },
    );
    console.log(`[docker-image-builder] Image "${image}" built successfully`);
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

/**
 * Build from the files a workflow carries, already on the host. `dockerfile` is
 * a path from the root of those files and the context is all of them unless the
 * step named one, so `COPY scripts/ /scripts/` from a `container/Dockerfile`
 * works as it does in a repository (`resolveCarriedBuildPaths`).
 */
export async function buildImageFromDirectory(options: {
  image: string;
  contextDir: string;
  dockerfile?: string;
  context?: string;
  artifactsHash?: string;
  workflow?: string;
  namespace?: string;
}): Promise<void> {
  const { image, contextDir, dockerfile = 'Dockerfile', context, artifactsHash, workflow, namespace } = options;
  const paths = resolveCarriedBuildPaths(dockerfile, context);
  if (paths === null) {
    throw new Error(`Dockerfile "${dockerfile}" or context "${context ?? ''}" is outside the workflow's files.`);
  }
  console.log(`[docker-image-builder] Building image "${image}" from ${join(contextDir, paths.context)}`);
  // argv form, not a shell string: the label values carry a workflow name and
  // a namespace, neither of which is safe to interpolate.
  execFileSync(
    'docker',
    [
      'build',
      '-t', image,
      ...carriedImageLabelArgs({ artifactsHash: artifactsHash ?? '', dockerfile, context, workflow, namespace }),
      '-f', join(contextDir, paths.dockerfile),
      join(contextDir, paths.context),
    ],
    { stdio: 'pipe' },
  );
  console.log(`[docker-image-builder] Image "${image}" built successfully`);
}

export async function ensureImage(options: EnsureImageOptions): Promise<void> {
  const { image, repoUrl, repoRef, commit, dockerfile, context, repoToken, contextDir, artifactsHash, workflow, namespace } = options;

  // A directory the caller already has. A derived tag already names the
  // content, but a tag the step named does not, so an existing image is reused
  // only when its label says it was built from these files — the same question
  // the commit label answers for a repo build. A job queued without a hash has
  // nothing to compare, and reuses what is there as it did before the label.
  if (contextDir !== undefined) {
    const existingLock = buildLocks.get(image);
    if (existingLock) {
      // The build waited on may have been of other files under the same tag.
      await existingLock;
      return ensureImage(options);
    }
    const buildPromise = (async () => {
      try {
        if (await imageExistsLocally(image)) {
          if (artifactsHash === undefined || (await getImageBuildLabel(image, BUILD_LABELS.artifacts)) === artifactsHash) {
            console.log(`[docker-image-builder] Image "${image}" already built from these files`);
            return;
          }
          console.log(`[docker-image-builder] Image "${image}" built from other files, rebuilding`);
        }
        await buildImageFromDirectory({ image, contextDir, dockerfile, context, artifactsHash, workflow, namespace });
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

      await buildImageFromRepo({ image, repoUrl, repoRef, commit, dockerfile, context, repoToken, workflow, namespace });
    } finally {
      buildLocks.delete(image);
    }
  })();

  buildLocks.set(image, buildPromise);
  await buildPromise;
}

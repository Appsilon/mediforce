/**
 * Lazy Docker image builder for the BullMQ worker.
 *
 * Lightweight copy of agent-runtime/plugins/docker-image-builder.ts.
 * Duplicated to avoid pulling agent-runtime into container-worker.
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  BUILD_CONTEXT_MAX_BYTES,
  BUILD_LABELS,
  buildProvenanceLabelArgs,
  carriedImageLabelArgs,
  imageTagTakenMessage,
  normalizeRepoPath,
  redactRepoCredentials,
  resolveDockerBuildPaths,
  resolveRepoCloneTargets,
  uploadedImageLabelArgs,
  type BuildUploadedImageRequest,
  type DockerBuildPaths,
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

/**
 * Refuse a build path the checkout resolves outside the clone. Keep in sync
 * with the copy in `packages/agent-runtime/src/plugins/docker-image-builder.ts`.
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

export async function buildImageFromRepo(options: {
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
}): Promise<void> {
  const { image, repoUrl, commit, context, repoToken, workflow, namespace } = options;
  // Resolved for `-f` and the context; the labels keep the inputs as named,
  // which is what `deriveBuildTag` hashed (see `resolveDockerBuildPaths`).
  const paths = resolveDockerBuildPaths(options.dockerfile, context);
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-build-'));

  try {
    cloneRepoAtCommit(buildDir, options.repoRef ?? repoUrl, commit, repoToken);
    console.log(`[docker-image-builder] Building image "${image}" from ${repoUrl}@${commit.slice(0, 8)}`);
    buildDirectory(
      buildDir,
      paths,
      image,
      buildProvenanceLabelArgs({ repoUrl, commit, dockerfile: options.dockerfile ?? '', context, workflow, namespace, repoToken }),
    );
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }
}

/**
 * Build from the files a workflow carries, already on the host. `dockerfile` is
 * a path from the root of those files and the context is always all of them, so
 * `COPY scripts/ /scripts/` from a `container/Dockerfile` works (`carriedDockerfile`).
 * Mirrors `buildImageFromDirectory` in agent-runtime.
 */
export async function buildImageFromDirectory(options: {
  image: string;
  contextDir: string;
  dockerfile?: string;
  artifactsHash?: string;
  workflow?: string;
  namespace?: string;
}): Promise<void> {
  const { image, contextDir, dockerfile = 'Dockerfile', artifactsHash, workflow, namespace } = options;
  const dockerfilePath = normalizeRepoPath(dockerfile);
  if (dockerfilePath === null || dockerfilePath === '') {
    throw new Error(`Dockerfile "${dockerfile}" is outside the workflow's files.`);
  }
  console.log(`[docker-image-builder] Building image "${image}" from ${contextDir}`);
  // argv form, not a shell string: the label values carry a workflow name and
  // a namespace, neither of which is safe to interpolate.
  execFileSync(
    'docker',
    [
      'build',
      '-t', image,
      ...carriedImageLabelArgs({ artifactsHash: artifactsHash ?? '', dockerfile, workflow, namespace }),
      '-f', join(contextDir, dockerfilePath),
      contextDir,
    ],
    { stdio: 'pipe' },
  );
  console.log(`[docker-image-builder] Image "${image}" built successfully`);
}

/**
 * `docker build` of a context already on disk — a checkout or an extracted
 * upload. Refuses a path reached through a symlink first, then builds.
 */
function buildDirectory(buildDir: string, paths: DockerBuildPaths, image: string, labelArgs: string[]): void {
  assertInsideClone(buildDir, paths.context);
  assertInsideClone(buildDir, paths.dockerfile);
  // argv form, not a shell string: the label values carry a repo URL, a
  // workflow name and a namespace, none of which are safe to interpolate.
  execFileSync(
    'docker',
    ['build', '-t', image, ...labelArgs, '-f', join(buildDir, paths.dockerfile), join(buildDir, paths.context)],
    { stdio: 'pipe' },
  );
  console.log(`[docker-image-builder] Image "${image}" built successfully`);
}

/** An uploaded context over the size limit. The platform refuses one before
 *  it gets here; the worker counts again for a caller that skipped it. */
export class BuildContextTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`The uploaded build context is over the ${String(maxBytes)}-byte limit.`);
    this.name = 'BuildContextTooLargeError';
  }
}

function limitBytes(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      callback(seen > maxBytes ? new BuildContextTooLargeError(maxBytes) : null, chunk);
    },
  });
}

/** Unpack an uploaded context with the host's own `tar` — the second line of
 *  defence after `checkBuildContextArchive`, `assertInsideClone` the third. */
async function extractArchive(archive: Readable, targetDir: string, maxBytes: number): Promise<void> {
  const child = spawn('tar', ['-x', '--no-same-owner', '-f', '-', '-C', targetDir], {
    stdio: ['pipe', 'ignore', 'pipe'],
  });
  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exited = new Promise<number | null>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });

  // Both settle before either is judged: `tar` giving up mid-stream breaks the
  // pipe, and its own message is the one worth reporting — unless the stream
  // was cut for size, which is what made `tar` give up.
  const [piped, exitCode] = await Promise.allSettled([pipeline(archive, limitBytes(maxBytes), child.stdin), exited]);
  if (piped.status === 'rejected' && piped.reason instanceof BuildContextTooLargeError) throw piped.reason;
  if (exitCode.status === 'rejected' || exitCode.value !== 0) {
    const reason = Buffer.concat(stderr).toString('utf8').trim();
    throw new Error(`Could not unpack the uploaded build context${reason === '' ? '.' : `: ${reason}`}`);
  }
  if (piped.status === 'rejected') throw piped.reason;
}

/** An upload aimed at a tag the daemon already has. */
export class ImageTagTakenError extends Error {
  constructor(image: string) {
    super(imageTagTakenMessage(image));
    this.name = 'ImageTagTakenError';
  }
}

/** Whether the daemon has `image`. A daemon that cannot answer throws: it
 *  cannot promise the tag is free. */
function daemonHasImage(image: string): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { stdio: 'pipe' });
    return true;
  } catch (error) {
    const stderr = error instanceof Error && 'stderr' in error ? String(error.stderr) : '';
    if (/no such image/i.test(stderr)) return false;
    throw error;
  }
}

/**
 * Build an uploaded context (#1345): extracted, not piped to `docker build -`,
 * and built under a throwaway tag that is moved onto `request.image` only if
 * that tag is still free once the build is done (ADR-0022).
 */
export async function buildImageFromUpload(
  request: BuildUploadedImageRequest,
  archive: Readable,
  maxBytes: number = BUILD_CONTEXT_MAX_BYTES,
): Promise<void> {
  const paths = resolveDockerBuildPaths(request.dockerfile, '.');
  const staging = `mediforce-upload-staging:${randomUUID()}`;
  const buildDir = await mkdtemp(join(tmpdir(), 'mediforce-upload-'));

  try {
    await extractArchive(archive, buildDir, maxBytes);
    console.log(`[docker-image-builder] Building image "${request.image}" from an uploaded context`);
    buildDirectory(buildDir, paths, staging, uploadedImageLabelArgs(request.namespace));
  } finally {
    await rm(buildDir, { recursive: true, force: true });
  }

  try {
    if (daemonHasImage(request.image)) throw new ImageTagTakenError(request.image);
    execFileSync('docker', ['tag', staging, request.image], { stdio: 'pipe' });
  } finally {
    removeStagingTag(staging);
  }
}

/** Only the tag goes: once retagged, the image itself stays. A failure is
 *  logged, never thrown over the error that brought the build here. */
function removeStagingTag(staging: string): void {
  try {
    execFileSync('docker', ['image', 'rm', staging], { stdio: 'pipe' });
  } catch (error) {
    console.warn(`[docker-image-builder] Could not remove "${staging}":`, error);
  }
}

export async function ensureImage(options: {
  image: string;
  repoUrl?: string;
  repoRef?: string;
  commit?: string;
  dockerfile?: string;
  context?: string;
  repoToken?: string;
  contextDir?: string;
  artifactsHash?: string;
  workflow?: string;
  namespace?: string;
}): Promise<void> {
  const { image, repoUrl, repoRef, commit, dockerfile, context, repoToken, contextDir, artifactsHash, workflow, namespace } = options;

  // A tag the step named says nothing about the files, so an existing image is
  // reused only when its label says it was built from these ones. A job queued
  // without a hash has nothing to compare, and reuses what is there.
  if (contextDir !== undefined) {
    if (await imageExistsLocally(image)) {
      if (artifactsHash === undefined || (await getImageBuildLabel(image, BUILD_LABELS.artifacts)) === artifactsHash) {
        console.log(`[docker-image-builder] Image "${image}" already built from these files`);
        return;
      }
      console.log(`[docker-image-builder] Image "${image}" built from other files, rebuilding`);
    }
    await buildImageFromDirectory({ image, contextDir, dockerfile, artifactsHash, workflow, namespace });
    return;
  }

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

  await buildImageFromRepo({ image, repoUrl, repoRef, commit, dockerfile, context, repoToken, workflow, namespace });
}

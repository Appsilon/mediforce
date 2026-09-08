import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { WorkflowArtifact } from '@mediforce/platform-core';

/** Where a workflow's own files appear inside a container, read-only. Steps
 *  name them from here: `python3 /artifacts/scripts/poll.py`. */
export const CONTAINER_ARTIFACTS_MOUNT = '/artifacts';

const ARTIFACTS_CACHE_DIR = join(tmpdir(), 'mediforce-artifacts');

/** Written last, so a directory that exists without it was interrupted and is
 *  rewritten rather than mounted half-populated. */
const COMPLETE_MARKER = '.mediforce-artifacts-complete';

/**
 * Content-addressed directory for a set of artifacts. Keyed on the files
 * themselves rather than the workflow version, so every step of every run of
 * an unchanged workflow shares one write, and an edited file gets a directory
 * of its own instead of overwriting the one a running step is reading.
 *
 * Under the system temp dir on purpose: both the orchestrator and the container
 * worker bind-mount it, which is what makes a host path resolve to the same
 * bytes inside a container.
 */
export function artifactsDir(artifacts: WorkflowArtifact[]): string {
  const canonical = [...artifacts]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((artifact) => `${artifact.path}\0${artifact.contents}`)
    .join('\0\0');
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return join(ARTIFACTS_CACHE_DIR, hash);
}

/**
 * Image tag for a Dockerfile the workflow carries. Derived from the files, so
 * an edit builds a new image and a rerun of unchanged files finds the one that
 * is already there — the staleness question a commit label answers for a repo
 * build has no equivalent here, because the tag *is* the content.
 */
export function artifactsBuildTag(artifacts: WorkflowArtifact[], dockerfile: string): string {
  const hash = createHash('sha256')
    .update(`${artifactsDir(artifacts)}\0${dockerfile}`)
    .digest('hex')
    .slice(0, 12);
  return `mediforce-artifacts:${hash}`;
}

/** The same rule `WorkflowArtifactSchema` applies, enforced again at the point
 *  of writing: a definition stored before that check, or reaching here around
 *  it, must not be able to write outside the directory. */
function assertContainedPath(path: string): void {
  const segments = path.split('/');
  const contained =
    path !== '' &&
    path.startsWith('/') === false &&
    path.includes('\\') === false &&
    segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (contained === false) {
    throw new Error(`artifact path '${path}' does not name a file inside the workflow`);
  }
}

/**
 * Writes a workflow's artifacts to a host directory and returns it, ready to be
 * bind-mounted at {@link CONTAINER_ARTIFACTS_MOUNT}. Returns null when the
 * workflow carries none, so callers add no mount at all.
 *
 * Files are written executable: a step is free to name one as its command
 * rather than passing it to an interpreter.
 */
export async function materializeArtifacts(
  artifacts: WorkflowArtifact[] | undefined,
): Promise<string | null> {
  if (artifacts === undefined || artifacts.length === 0) return null;
  for (const artifact of artifacts) assertContainedPath(artifact.path);

  const dir = artifactsDir(artifacts);
  if (existsSync(join(dir, COMPLETE_MARKER))) return dir;

  // A directory without the marker is either absent or the remains of an
  // interrupted write, and a rewrite starts from nothing so no file of an
  // earlier attempt survives inside a mount.
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const artifact of artifacts) {
    const target = join(dir, artifact.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, artifact.contents, { mode: 0o755 });
  }
  await writeFile(join(dir, COMPLETE_MARKER), '', { mode: 0o644 });
  return dir;
}

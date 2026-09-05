// Internal module for system/get-docker-info.ts — extracted so the shell-out
// and HTTP-fetch paths can be unit-tested without spinning up Next.js.

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  imageCapabilityProbeArgs,
  imageHistoryArgs,
  imageInspectArgs,
  IMAGE_CAPABILITY_PROBE_TIMEOUT_MS,
  IMAGE_HISTORY_TIMEOUT_MS,
  ImageBuildStepSchema,
  ImageCapabilitiesSchema,
  parseImageCapabilities,
  parseImageHistory,
  parseImageInspect,
  readProvenanceLabels,
  resolveImageLineage,
  shortImageId,
  unknownImageCapabilities,
  type ImageBuildStep,
  type ImageCapabilities,
  type InspectedImage,
} from '@mediforce/platform-core';
import {
  DockerDiskInfoSchema,
  DockerImageInfoSchema,
} from '../../contract/system';
import type {
  DockerDiskInfo,
  DockerImageInfo,
  DockerInfoResponse,
} from '../../contract/system';

const execFileAsync = promisify(execFile);

const DEFAULT_CONTAINER_WORKER_URL = 'http://container-worker:3001';

/**
 * "Local agent" mode = developer laptop or single-binary deployment running
 * the engine in-process with no external worker. In that mode we shell out
 * to the local Docker daemon; otherwise we query the container-worker HTTP
 * endpoint.
 */
export function isLocalAgentMode(): boolean {
  return process.env.ALLOW_LOCAL_AGENTS === 'true' && !process.env.REDIS_URL;
}

/**
 * Labels and layers for each image, keyed by short id.
 *
 * A failure — an image removed between the two calls, an old daemon — leaves
 * every row unannotated instead of failing the listing.
 */
async function fetchInspected(
  exec: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>,
  imageIds: readonly string[],
): Promise<Map<string, InspectedImage>> {
  if (imageIds.length === 0) return new Map();
  try {
    const { stdout } = await exec('docker', imageInspectArgs(imageIds));
    return parseImageInspect(stdout);
  } catch {
    return new Map();
  }
}

/** What a caller gets when it wants the listing without the disk statistics. */
export interface DaemonImageListing {
  available: boolean;
  images: readonly DockerImageInfo[];
}

export interface FetchFromLocalDockerOptions {
  readonly exec?: (
    file: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
}

export interface ProbeImageCapabilitiesOptions {
  readonly exec?: (
    file: string,
    args: readonly string[],
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
  readonly workerSecret?: string;
}

export async function probeLocalImageCapabilities(
  image: string,
  options: ProbeImageCapabilitiesOptions = {},
): Promise<ImageCapabilities> {
  const exec = options.exec ?? ((file, args, execOptions) =>
    execFileAsync(file, [...args], execOptions) as Promise<{ stdout: string; stderr: string }>);
  try {
    const { stdout } = await exec(
      'docker',
      imageCapabilityProbeArgs(image),
      { timeout: IMAGE_CAPABILITY_PROBE_TIMEOUT_MS },
    );
    return parseImageCapabilities(stdout);
  } catch (error) {
    const stdout = error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
      ? error.stdout
      : '';
    return stdout.length > 0 ? parseImageCapabilities(stdout) : unknownImageCapabilities();
  }
}

export async function probeContainerWorkerImageCapabilities(
  image: string,
  options: ProbeImageCapabilitiesOptions = {},
): Promise<ImageCapabilities> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? process.env.CONTAINER_WORKER_URL ?? DEFAULT_CONTAINER_WORKER_URL;
  // The probe starts a container on the worker host, so it carries the same
  // secret the image-delete route does. An estate that sets none is unchanged:
  // the worker only enforces the header once `CONTAINER_WORKER_SECRET` is set.
  const workerSecret = options.workerSecret ?? process.env.CONTAINER_WORKER_SECRET ?? '';
  const headers: Record<string, string> = workerSecret === ''
    ? {}
    : { 'X-Worker-Secret': workerSecret };
  try {
    const response = await fetchImpl(
      `${baseUrl}/images/${encodeURIComponent(image)}/capabilities`,
      { headers },
    );
    if (!response.ok) return unknownImageCapabilities();
    const parsed = ImageCapabilitiesSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : unknownImageCapabilities();
  } catch {
    return unknownImageCapabilities();
  }
}

export async function probeImageCapabilities(image: string): Promise<ImageCapabilities> {
  return isLocalAgentMode()
    ? probeLocalImageCapabilities(image)
    : probeContainerWorkerImageCapabilities(image);
}

export interface FetchImageHistoryOptions {
  readonly exec?: (
    file: string,
    args: readonly string[],
    options?: { timeout: number },
  ) => Promise<{ stdout: string; stderr: string }>;
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

export async function fetchLocalImageHistory(
  image: string,
  options: FetchImageHistoryOptions = {},
): Promise<ImageBuildStep[] | null> {
  const exec = options.exec ?? ((file, args, execOptions) =>
    execFileAsync(file, [...args], execOptions) as Promise<{ stdout: string; stderr: string }>);
  try {
    const { stdout } = await exec('docker', imageHistoryArgs(image), {
      timeout: IMAGE_HISTORY_TIMEOUT_MS,
    });
    return parseImageHistory(stdout);
  } catch {
    return null;
  }
}

export async function fetchContainerWorkerImageHistory(
  image: string,
  options: FetchImageHistoryOptions = {},
): Promise<ImageBuildStep[] | null> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl =
    options.baseUrl ?? process.env.CONTAINER_WORKER_URL ?? DEFAULT_CONTAINER_WORKER_URL;
  try {
    // The same ceiling the local path gives the `docker` call: a worker that
    // accepts the connection and then never answers would otherwise hold a
    // catalog read open indefinitely, where the local path degrades in ten
    // seconds.
    const response = await fetchImpl(`${baseUrl}/images/${encodeURIComponent(image)}/history`, {
      signal: AbortSignal.timeout(IMAGE_HISTORY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const parsed = z.array(ImageBuildStepSchema).safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * An image's layer summary, or `null` when the daemon could not answer.
 *
 * Unlike the capability probe this starts no container — it reads metadata the
 * daemon already holds — which is why the worker leaves it ungated alongside
 * the other listings and why it can run on an ordinary read.
 *
 * `null` rather than an empty list, because the caller subtracts one history
 * from another: a failed read reported as "no steps" would make a base look
 * like it contributed nothing and publish everything the child inherited as
 * steps the child added. Unavailable is a state, not an error (ADR-0021
 * decision 2) — the entry still renders, without its summary.
 */
export async function fetchImageHistory(image: string): Promise<ImageBuildStep[] | null> {
  return isLocalAgentMode()
    ? fetchLocalImageHistory(image)
    : fetchContainerWorkerImageHistory(image);
}

type Exec = (
  file: string,
  args: readonly string[],
) => Promise<{ stdout: string; stderr: string }>;

function localExec(options: FetchFromLocalDockerOptions): Exec {
  return (
    options.exec ??
    ((file, args) => execFileAsync(file, [...args]) as Promise<{ stdout: string; stderr: string }>)
  );
}

/** `docker images` plus the one `docker image inspect` batch that annotates it.
 *  `null` on a listing that does not parse, which reads as an unavailable
 *  daemon. */
async function localImageRows(exec: Exec): Promise<DockerImageInfo[] | null> {
  const imagesResult = await exec('docker', ['images', '--format', '{{json .}}']);

  const rawImages = imagesResult.stdout.trim();
  const parsedRows =
    rawImages.length === 0 ? [] : rawImages.split('\n').map((line) => JSON.parse(line));

  // One id can carry several tags — inspect each only once.
  const inspected = await fetchInspected(exec, [
    ...new Set(parsedRows.map((row: { ID: string }) => row.ID)),
  ]);
  const lineage = resolveImageLineage(inspected);

  const rawImageList = parsedRows.map((parsed) => {
    const id = shortImageId(parsed.ID);
    return {
      repository: parsed.Repository,
      tag: parsed.Tag,
      id: parsed.ID,
      size: parsed.Size,
      created: parsed.CreatedSince,
      ...readProvenanceLabels(inspected.get(id)?.labels),
      ...lineage.get(id),
    };
  });

  const parsed = z.array(DockerImageInfoSchema).safeParse(rawImageList);
  return parsed.success ? parsed.data : null;
}

/** `docker system df`. Seconds of wall clock on a busy daemon, which is why it
 *  is its own call: only the infrastructure page reads its result. */
async function localDisk(exec: Exec): Promise<DockerDiskInfo | null> {
  const diskResult = await exec('docker', ['system', 'df', '--format', '{{json .}}']);

  const diskRows = diskResult.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const findRow = (type: string): Record<string, unknown> | undefined =>
    diskRows.find((row: { Type?: string }) => row.Type === type);
  const imgRow = findRow('Images');
  const ctrRow = findRow('Containers');
  const cacheRow = findRow('Build Cache');

  const parsed = DockerDiskInfoSchema.safeParse({
    images: {
      totalCount: Number(imgRow?.TotalCount ?? 0),
      size: String(imgRow?.Size ?? '0B'),
    },
    containers: {
      totalCount: Number(ctrRow?.TotalCount ?? 0),
      active: Number(ctrRow?.Active ?? 0),
      size: String(ctrRow?.Size ?? '0B'),
    },
    buildCache: { size: String(cacheRow?.Size ?? '0B') },
  });
  return parsed.success ? parsed.data : null;
}

/** Shell out to `docker images` + `docker system df` and normalise the output. */
export async function fetchFromLocalDocker(
  options: FetchFromLocalDockerOptions = {},
): Promise<DockerInfoResponse> {
  const exec = localExec(options);

  const [images, disk] = await Promise.all([localImageRows(exec), localDisk(exec)]);
  if (images === null || disk === null) return { available: false };

  return { available: true, images, disk };
}

/** The listing alone, skipping `docker system df`. */
export async function fetchImagesFromLocalDocker(
  options: FetchFromLocalDockerOptions = {},
): Promise<DaemonImageListing> {
  const images = await localImageRows(localExec(options));
  return images === null ? { available: false, images: [] } : { available: true, images };
}

export interface FetchFromContainerWorkerOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

function workerBaseUrl(options: FetchFromContainerWorkerOptions): string {
  return options.baseUrl ?? process.env.CONTAINER_WORKER_URL ?? DEFAULT_CONTAINER_WORKER_URL;
}

async function workerImageRows(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
): Promise<DockerImageInfo[] | null> {
  const res = await fetchImpl(`${baseUrl}/images`);
  if (!res.ok) return null;
  const parsed = z.array(DockerImageInfoSchema).safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

async function workerDisk(
  fetchImpl: typeof globalThis.fetch,
  baseUrl: string,
): Promise<DockerDiskInfo | null> {
  const res = await fetchImpl(`${baseUrl}/disk`);
  if (!res.ok) return null;
  const parsed = DockerDiskInfoSchema.safeParse(await res.json());
  return parsed.success ? parsed.data : null;
}

/** Call the container-worker HTTP endpoints and normalise the output. */
export async function fetchFromContainerWorker(
  options: FetchFromContainerWorkerOptions = {},
): Promise<DockerInfoResponse> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl = workerBaseUrl(options);

  const [images, disk] = await Promise.all([
    workerImageRows(fetchImpl, baseUrl),
    workerDisk(fetchImpl, baseUrl),
  ]);

  if (images === null || disk === null) return { available: false };

  return { available: true, images, disk };
}

/** The listing alone, skipping the worker's `/disk` endpoint. */
export async function fetchImagesFromContainerWorker(
  options: FetchFromContainerWorkerOptions = {},
): Promise<DaemonImageListing> {
  const images = await workerImageRows(options.fetch ?? globalThis.fetch, workerBaseUrl(options));
  return images === null ? { available: false, images: [] } : { available: true, images };
}

/**
 * The daemon's image listing, and nothing else.
 *
 * `getDockerInfo` also gathers `docker system df`, which is seconds of wall
 * clock on a busy daemon and is read by exactly one screen — the infrastructure
 * page's disk cards. Every Image Catalog read wants the listing and never the
 * disk stats, and a catalog read now happens on a page load and on a poll, so
 * it asks for the half it uses. An unreachable daemon is `available: false`
 * with no images, never a thrown request (ADR-0021 decision 2).
 */
export async function fetchDaemonImages(): Promise<DaemonImageListing> {
  try {
    return isLocalAgentMode()
      ? await fetchImagesFromLocalDocker()
      : await fetchImagesFromContainerWorker();
  } catch {
    return { available: false, images: [] };
  }
}

// Internal module for system/get-docker-info.ts — extracted so the shell-out
// and HTTP-fetch paths can be unit-tested without spinning up Next.js.

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  imageCapabilityProbeArgs,
  imageLabelsInspectArgs,
  IMAGE_CAPABILITY_PROBE_TIMEOUT_MS,
  ImageCapabilitiesSchema,
  parseImageCapabilities,
  parseImageProvenance,
  shortImageId,
  unknownImageCapabilities,
  type ImageCapabilities,
  type ReadImageProvenance,
} from '@mediforce/platform-core';
import {
  DockerDiskInfoSchema,
  DockerImageInfoSchema,
} from '../../contract/system';
import type { DockerInfoResponse } from '../../contract/system';

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
 * Build provenance for each image, keyed by short id.
 *
 * A failure — an image removed between the two calls, an old daemon — leaves
 * every row unannotated instead of failing the listing.
 */
async function fetchProvenance(
  exec: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>,
  imageIds: readonly string[],
): Promise<Map<string, ReadImageProvenance>> {
  if (imageIds.length === 0) return new Map();
  try {
    const { stdout } = await exec('docker', imageLabelsInspectArgs(imageIds));
    return parseImageProvenance(stdout);
  } catch {
    return new Map();
  }
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

/** Shell out to `docker images` + `docker system df` and normalise the output. */
export async function fetchFromLocalDocker(
  options: FetchFromLocalDockerOptions = {},
): Promise<DockerInfoResponse> {
  const exec =
    options.exec ??
    ((file, args) => execFileAsync(file, [...args]) as Promise<{ stdout: string; stderr: string }>);

  const [imagesResult, diskResult] = await Promise.all([
    exec('docker', ['images', '--format', '{{json .}}']),
    exec('docker', ['system', 'df', '--format', '{{json .}}']),
  ]);

  const rawImages = imagesResult.stdout.trim();
  const parsedRows =
    rawImages.length === 0 ? [] : rawImages.split('\n').map((line) => JSON.parse(line));

  // One id can carry several tags — inspect each only once.
  const provenance = await fetchProvenance(exec, [
    ...new Set(parsedRows.map((row: { ID: string }) => row.ID)),
  ]);

  const rawImageList = parsedRows.map((parsed) => ({
    repository: parsed.Repository,
    tag: parsed.Tag,
    id: parsed.ID,
    size: parsed.Size,
    created: parsed.CreatedSince,
    ...provenance.get(shortImageId(parsed.ID)),
  }));

  const diskRows = diskResult.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const findRow = (type: string): Record<string, unknown> | undefined =>
    diskRows.find((row: { Type?: string }) => row.Type === type);
  const imgRow = findRow('Images');
  const ctrRow = findRow('Containers');
  const cacheRow = findRow('Build Cache');

  const rawDisk = {
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
  };

  const imagesParsed = z.array(DockerImageInfoSchema).safeParse(rawImageList);
  const diskParsed = DockerDiskInfoSchema.safeParse(rawDisk);

  if (!imagesParsed.success || !diskParsed.success) {
    return { available: false };
  }

  return { available: true, images: imagesParsed.data, disk: diskParsed.data };
}

export interface FetchFromContainerWorkerOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly baseUrl?: string;
}

/** Call the container-worker HTTP endpoints and normalise the output. */
export async function fetchFromContainerWorker(
  options: FetchFromContainerWorkerOptions = {},
): Promise<DockerInfoResponse> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const baseUrl =
    options.baseUrl ?? process.env.CONTAINER_WORKER_URL ?? DEFAULT_CONTAINER_WORKER_URL;

  const [imagesRes, diskRes] = await Promise.all([
    fetchImpl(`${baseUrl}/images`),
    fetchImpl(`${baseUrl}/disk`),
  ]);

  if (!imagesRes.ok || !diskRes.ok) {
    return { available: false };
  }

  const imagesRaw = await imagesRes.json();
  const diskRaw = await diskRes.json();

  const imagesParsed = z.array(DockerImageInfoSchema).safeParse(imagesRaw);
  const diskParsed = DockerDiskInfoSchema.safeParse(diskRaw);

  if (!imagesParsed.success || !diskParsed.success) {
    return { available: false };
  }

  return { available: true, images: imagesParsed.data, disk: diskParsed.data };
}

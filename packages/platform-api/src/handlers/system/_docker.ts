// Internal module for system/get-docker-info.ts — extracted so the shell-out
// and HTTP-fetch paths can be unit-tested without spinning up Next.js.

import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  DockerDiskInfoSchema,
  DockerImageInfoSchema,
} from '../../contract/system.js';
import type { DockerInfoResponse } from '../../contract/system.js';

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

export interface FetchFromLocalDockerOptions {
  readonly exec?: (
    file: string,
    args: readonly string[],
  ) => Promise<{ stdout: string; stderr: string }>;
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
  const rawImageList =
    rawImages.length === 0
      ? []
      : rawImages.split('\n').map((line) => {
          const parsed = JSON.parse(line);
          return {
            repository: parsed.Repository,
            tag: parsed.Tag,
            id: parsed.ID,
            size: parsed.Size,
            created: parsed.CreatedSince,
          };
        });

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

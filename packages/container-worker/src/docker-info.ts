import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  imageLabelsInspectArgs,
  parseImageProvenance,
  shortImageId,
  type ReadImageProvenance,
} from '@mediforce/platform-core';

const execFileAsync = promisify(execFile);

/** Mirrors `DockerImageInfoSchema` in `@mediforce/platform-api`, which parses
 *  this endpoint's response. The `build*` fields come from the labels the
 *  image builder writes and are absent on every image we did not build. */
export interface DockerImage extends ReadImageProvenance {
  repository: string;
  tag: string;
  id: string;
  size: string;
  created: string;
}

export interface DockerDiskUsage {
  images: { totalCount: number; size: string };
  containers: { totalCount: number; active: number; size: string };
  buildCache: { size: string };
}

/**
 * Build provenance for each image, keyed by short id.
 *
 * A failure — an image removed between the two calls, an old daemon — leaves
 * every row unannotated instead of failing the listing.
 */
async function fetchProvenance(
  imageIds: readonly string[],
): Promise<Map<string, ReadImageProvenance>> {
  if (imageIds.length === 0) return new Map();
  try {
    const { stdout } = await execFileAsync('docker', imageLabelsInspectArgs(imageIds));
    return parseImageProvenance(stdout);
  } catch {
    return new Map();
  }
}

export async function listImages(): Promise<DockerImage[]> {
  const { stdout } = await execFileAsync('docker', ['images', '--format', '{{json .}}']);
  const raw = stdout.trim();
  if (raw.length === 0) return [];

  const parsedRows = raw.split('\n').map((line) => JSON.parse(line));
  // One id can carry several tags — inspect each only once.
  const provenance = await fetchProvenance([...new Set<string>(parsedRows.map((row) => row.ID))]);

  return parsedRows.map((parsed) => ({
    repository: parsed.Repository,
    tag: parsed.Tag,
    id: parsed.ID,
    size: parsed.Size,
    created: parsed.CreatedSince,
    ...provenance.get(shortImageId(parsed.ID)),
  }));
}

export async function removeImage(imageId: string): Promise<string> {
  const { stdout } = await execFileAsync('docker', ['rmi', imageId]);
  return stdout.trim();
}

export async function getDiskUsage(): Promise<DockerDiskUsage> {
  const { stdout } = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}']);
  const rows = stdout.trim().split('\n').map((line) => JSON.parse(line));

  const find = (type: string) => rows.find((r) => r.Type === type);

  const images = find('Images');
  const containers = find('Containers');
  const buildCache = find('Build Cache');

  return {
    images: {
      totalCount: Number(images?.TotalCount ?? 0),
      size: images?.Size ?? '0B',
    },
    containers: {
      totalCount: Number(containers?.TotalCount ?? 0),
      active: Number(containers?.Active ?? 0),
      size: containers?.Size ?? '0B',
    },
    buildCache: {
      size: buildCache?.Size ?? '0B',
    },
  };
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  imageCapabilityProbeArgs,
  imageHistoryArgs,
  imageInspectArgs,
  IMAGE_CAPABILITY_PROBE_TIMEOUT_MS,
  IMAGE_HISTORY_TIMEOUT_MS,
  parseImageCapabilities,
  parseImageHistory,
  unknownImageCapabilities,
  parseImageInspect,
  readProvenanceLabels,
  resolveImageLineage,
  shortImageId,
  type ImageBuildStep,
  type ImageCapabilities,
  type ImageLineageFacts,
  type InspectedImage,
  type ReadImageProvenance,
} from '@mediforce/platform-core';

const execFileAsync = promisify(execFile);

/** Mirrors `DockerImageInfoSchema` in `@mediforce/platform-api`, which parses
 *  this endpoint's response. The `build*` fields come from the labels the
 *  image builder writes and are absent on every image we did not build; the
 *  lineage fields are computed from the layers of the whole listing. */
export interface DockerImage extends ReadImageProvenance, Partial<ImageLineageFacts> {
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
 * Labels and layers for each image, keyed by short id.
 *
 * A failure — an image removed between the two calls, an old daemon — leaves
 * every row unannotated instead of failing the listing.
 */
async function fetchInspected(
  imageIds: readonly string[],
): Promise<Map<string, InspectedImage>> {
  if (imageIds.length === 0) return new Map();
  try {
    const { stdout } = await execFileAsync('docker', imageInspectArgs(imageIds));
    return parseImageInspect(stdout);
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
  const inspected = await fetchInspected([...new Set<string>(parsedRows.map((row) => row.ID))]);
  const lineage = resolveImageLineage(inspected);

  return parsedRows.map((parsed) => {
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
}

export async function probeImageCapabilities(image: string): Promise<ImageCapabilities> {
  try {
    const { stdout } = await execFileAsync(
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

/** An image's layer summary. Metadata only — no container starts — so it is
 *  read on ordinary catalog reads and left ungated like the other listings. */
export async function getImageHistory(image: string): Promise<ImageBuildStep[]> {
  const { stdout } = await execFileAsync('docker', imageHistoryArgs(image), {
    timeout: IMAGE_HISTORY_TIMEOUT_MS,
  });
  return parseImageHistory(stdout);
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

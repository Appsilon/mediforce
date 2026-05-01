import { execSync } from 'node:child_process';
import { z } from 'zod';

export const DockerImageSchema = z.object({
  repository: z.string(),
  tag: z.string(),
  id: z.string(),
  size: z.string(),
  created: z.string(),
});

export type DockerImage = z.infer<typeof DockerImageSchema>;

export const DockerDiskUsageSchema = z.object({
  images: z.object({ totalCount: z.number(), size: z.string() }),
  containers: z.object({ totalCount: z.number(), active: z.number(), size: z.string() }),
  buildCache: z.object({ size: z.string() }),
});

export type DockerDiskUsage = z.infer<typeof DockerDiskUsageSchema>;

export function listImages(): DockerImage[] {
  const raw = execSync("docker images --format '{{json .}}'", { stdio: 'pipe' }).toString().trim();
  if (raw.length === 0) return [];

  return raw.split('\n').map((line) => {
    const parsed = JSON.parse(line);
    return {
      repository: parsed.Repository,
      tag: parsed.Tag,
      id: parsed.ID,
      size: parsed.Size,
      created: parsed.CreatedSince,
    };
  });
}

export function getDiskUsage(): DockerDiskUsage {
  const raw = execSync("docker system df --format '{{json .}}'", { stdio: 'pipe' }).toString().trim();
  const rows = raw.split('\n').map((line) => JSON.parse(line));

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

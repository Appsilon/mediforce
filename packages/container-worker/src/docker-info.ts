import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface DockerImage {
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

export async function listImages(): Promise<DockerImage[]> {
  const { stdout } = await execFileAsync('docker', ['images', '--format', '{{json .}}']);
  const raw = stdout.trim();
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

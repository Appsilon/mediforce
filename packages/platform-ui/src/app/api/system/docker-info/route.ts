import { NextRequest, NextResponse } from 'next/server';
import { DockerImageInfoSchema, DockerDiskInfoSchema } from '@mediforce/platform-api/contract';
import type { DockerInfoResponse } from '@mediforce/platform-api/contract';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const CONTAINER_WORKER_URL = process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001';

function isLocalAgentMode(): boolean {
  return process.env.ALLOW_LOCAL_AGENTS === 'true' && !process.env.REDIS_URL;
}

async function fetchFromLocalDocker(): Promise<DockerInfoResponse> {
  const [imagesResult, diskResult] = await Promise.all([
    execFileAsync('docker', ['images', '--format', '{{json .}}']),
    execFileAsync('docker', ['system', 'df', '--format', '{{json .}}']),
  ]);

  const rawImages = imagesResult.stdout.trim();
  const rawImageList = rawImages.length === 0 ? [] : rawImages.split('\n').map((line) => {
    const parsed = JSON.parse(line);
    return {
      repository: parsed.Repository,
      tag: parsed.Tag,
      id: parsed.ID,
      size: parsed.Size,
      created: parsed.CreatedSince,
    };
  });

  const diskRows = diskResult.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const find = (type: string) => diskRows.find((r) => r.Type === type);
  const imgRow = find('Images');
  const ctrRow = find('Containers');
  const cacheRow = find('Build Cache');

  const rawDisk = {
    images: { totalCount: Number(imgRow?.TotalCount ?? 0), size: String(imgRow?.Size ?? '0B') },
    containers: { totalCount: Number(ctrRow?.TotalCount ?? 0), active: Number(ctrRow?.Active ?? 0), size: String(ctrRow?.Size ?? '0B') },
    buildCache: { size: String(cacheRow?.Size ?? '0B') },
  };

  const imagesParsed = z.array(DockerImageInfoSchema).safeParse(rawImageList);
  const diskParsed = DockerDiskInfoSchema.safeParse(rawDisk);

  if (!imagesParsed.success || !diskParsed.success) {
    return { available: false };
  }

  return { available: true, images: imagesParsed.data, disk: diskParsed.data };
}

async function fetchFromContainerWorker(): Promise<DockerInfoResponse> {
  const [imagesRes, diskRes] = await Promise.all([
    fetch(`${CONTAINER_WORKER_URL}/images`),
    fetch(`${CONTAINER_WORKER_URL}/disk`),
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

export async function GET(_req: NextRequest): Promise<NextResponse<DockerInfoResponse>> {
  try {
    const result = isLocalAgentMode()
      ? await fetchFromLocalDocker()
      : await fetchFromContainerWorker();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ available: false } as const);
  }
}

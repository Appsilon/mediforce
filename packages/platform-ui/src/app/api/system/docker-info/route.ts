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

function hasAdminApiKey(req: NextRequest): boolean {
  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  if (typeof adminKey !== 'string' || adminKey === '') return false;
  const provided = req.headers.get('X-Api-Key');
  return provided === adminKey;
}

async function fetchFromLocalDocker(): Promise<DockerInfoResponse> {
  const [imagesResult, diskResult] = await Promise.all([
    execFileAsync('docker', ['images', '--format', '{{json .}}']),
    execFileAsync('docker', ['system', 'df', '--format', '{{json .}}']),
  ]);

  const rawImages = imagesResult.stdout.trim();
  const images = rawImages.length === 0 ? [] : rawImages.split('\n').map((line) => {
    const parsed = JSON.parse(line);
    return {
      repository: parsed.Repository as string,
      tag: parsed.Tag as string,
      id: parsed.ID as string,
      size: parsed.Size as string,
      created: parsed.CreatedSince as string,
    };
  });

  const diskRows = diskResult.stdout.trim().split('\n').map((line) => JSON.parse(line));
  const find = (type: string) => diskRows.find((r) => r.Type === type);
  const imgRow = find('Images');
  const ctrRow = find('Containers');
  const cacheRow = find('Build Cache');

  const disk = {
    images: { totalCount: Number(imgRow?.TotalCount ?? 0), size: (imgRow?.Size ?? '0B') as string },
    containers: { totalCount: Number(ctrRow?.TotalCount ?? 0), active: Number(ctrRow?.Active ?? 0), size: (ctrRow?.Size ?? '0B') as string },
    buildCache: { size: (cacheRow?.Size ?? '0B') as string },
  };

  return { available: true, images, disk };
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

export async function GET(req: NextRequest): Promise<NextResponse<DockerInfoResponse | { error: string }>> {
  if (!hasAdminApiKey(req)) {
    return NextResponse.json(
      { error: 'Forbidden — admin API key required' },
      { status: 403 },
    );
  }

  try {
    const result = isLocalAgentMode()
      ? await fetchFromLocalDocker()
      : await fetchFromContainerWorker();
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ available: false } as const);
  }
}

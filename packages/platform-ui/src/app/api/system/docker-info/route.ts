import { NextRequest, NextResponse } from 'next/server';
import { DockerImageInfoSchema, DockerDiskInfoSchema } from '@mediforce/platform-api/contract';
import type { DockerInfoResponse } from '@mediforce/platform-api/contract';
import { z } from 'zod';

const CONTAINER_WORKER_URL = process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001';

function hasAdminApiKey(req: NextRequest): boolean {
  const adminKey = process.env.PLATFORM_ADMIN_API_KEY;
  if (typeof adminKey !== 'string' || adminKey === '') return false;
  const provided = req.headers.get('X-Api-Key');
  return provided === adminKey;
}

export async function GET(req: NextRequest): Promise<NextResponse<DockerInfoResponse | { error: string }>> {
  if (!hasAdminApiKey(req)) {
    return NextResponse.json(
      { error: 'Forbidden — admin API key required' },
      { status: 403 },
    );
  }

  try {
    const [imagesRes, diskRes] = await Promise.all([
      fetch(`${CONTAINER_WORKER_URL}/images`),
      fetch(`${CONTAINER_WORKER_URL}/disk`),
    ]);

    if (!imagesRes.ok || !diskRes.ok) {
      return NextResponse.json({ available: false } as const);
    }

    const imagesRaw = await imagesRes.json();
    const diskRaw = await diskRes.json();

    const imagesParsed = z.array(DockerImageInfoSchema).safeParse(imagesRaw);
    const diskParsed = DockerDiskInfoSchema.safeParse(diskRaw);

    if (!imagesParsed.success || !diskParsed.success) {
      return NextResponse.json({ available: false } as const);
    }

    return NextResponse.json({ available: true, images: imagesParsed.data, disk: diskParsed.data } as const);
  } catch {
    return NextResponse.json({ available: false } as const);
  }
}

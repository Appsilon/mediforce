import { NextResponse } from 'next/server';
import type { DockerInfoResponse } from '@mediforce/platform-api/contract';

const CONTAINER_WORKER_URL = process.env.CONTAINER_WORKER_URL ?? 'http://container-worker:3001';

export async function GET(): Promise<NextResponse<DockerInfoResponse>> {
  try {
    const [imagesRes, diskRes] = await Promise.all([
      fetch(`${CONTAINER_WORKER_URL}/images`),
      fetch(`${CONTAINER_WORKER_URL}/disk`),
    ]);

    if (!imagesRes.ok || !diskRes.ok) {
      return NextResponse.json({ available: false } as const);
    }

    const images = await imagesRes.json();
    const disk = await diskRes.json();

    return NextResponse.json({ available: true, images, disk } as const);
  } catch {
    return NextResponse.json({ available: false } as const);
  }
}

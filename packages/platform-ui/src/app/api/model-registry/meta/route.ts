import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';

export async function GET(): Promise<NextResponse> {
  try {
    const { modelRegistryRepo } = getPlatformServices();
    const meta = await modelRegistryRepo.getMeta();
    return NextResponse.json({ meta });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to get meta' }, { status: 500 });
  }
}

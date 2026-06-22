import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { syncModels } from '@mediforce/platform-api/handlers';

export async function POST(): Promise<NextResponse> {
  const { modelRegistryRepo } = getPlatformServices();
  try {
    const result = await syncModels({ modelRegistryRepo });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Sync failed' }, { status: 502 });
  }
}

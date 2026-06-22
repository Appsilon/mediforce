import { NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { getModel } from '@mediforce/platform-api/handlers';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  const { modelRegistryRepo } = getPlatformServices();
  try {
    const result = await getModel({ id: decodeURIComponent(id) }, { modelRegistryRepo });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { UpdateRankingsInputSchema } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';
import { updateRankings } from '@mediforce/platform-api/handlers';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const input = UpdateRankingsInputSchema.parse(body);
    const { modelRegistryRepo } = getPlatformServices();
    const result = await updateRankings(input, { modelRegistryRepo });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update rankings' },
      { status: 500 },
    );
  }
}

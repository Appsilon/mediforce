import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformServices } from '@/lib/platform-services';
import { listModels } from '@mediforce/platform-api/handlers';
import { ListModelsInputSchema } from '@mediforce/platform-api/contract';

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const raw: Record<string, string> = {};
  for (const key of ['provider', 'supportsTools', 'supportsVision', 'minContextLength']) {
    const value = searchParams.get(key);
    if (value !== null) raw[key] = value;
  }
  try {
    const input = ListModelsInputSchema.parse(raw);
    const { modelRegistryRepo } = getPlatformServices();
    const result = await listModels(input, { modelRegistryRepo });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list models' },
      { status: 500 },
    );
  }
}

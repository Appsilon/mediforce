import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getPlatformServices } from '@/lib/platform-services';
import { validateModels } from '@mediforce/platform-api/handlers';
import { ValidateModelsInputSchema } from '@mediforce/platform-api/contract';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = await request.json();
    const input = ValidateModelsInputSchema.parse(body);
    const { modelRegistryRepo } = getPlatformServices();
    const result = await validateModels(input, { modelRegistryRepo });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to validate models' },
      { status: 500 },
    );
  }
}

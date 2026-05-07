import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import type { OpenRouterCreditsOutput } from '@mediforce/platform-api/contract';

const EMPTY: OpenRouterCreditsOutput = { available: false, limit: 0, usage: 0, remaining: 0 };

async function fetchCredits(apiKey: string): Promise<OpenRouterCreditsOutput> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return { ...EMPTY, error: `OpenRouter returned ${res.status}` };
    }

    const { data } = await res.json() as { data: { limit: number; usage: number; limit_remaining: number } };
    return { available: true, limit: data.limit, usage: data.usage, remaining: data.limit_remaining };
  } catch (err: unknown) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse<OpenRouterCreditsOutput>> {
  const namespace = req.nextUrl.searchParams.get('namespace');

  if (namespace) {
    const { namespaceSecretsRepo } = getPlatformServices();
    try {
      const secrets = await namespaceSecretsRepo.getSecrets(namespace);
      const apiKey = secrets['OPENROUTER_API_KEY'];
      if (!apiKey) {
        return NextResponse.json({ ...EMPTY, error: 'OPENROUTER_API_KEY not configured in workspace secrets' });
      }
      return NextResponse.json(await fetchCredits(apiKey));
    } catch (err: unknown) {
      return NextResponse.json({ ...EMPTY, error: err instanceof Error ? err.message : 'Failed to read namespace secrets' });
    }
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ...EMPTY, error: 'OPENROUTER_API_KEY not configured' });
  }
  return NextResponse.json(await fetchCredits(apiKey));
}

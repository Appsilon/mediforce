import { NextResponse } from 'next/server';

export interface OpenRouterCreditsResponse {
  available: boolean;
  limit: number;
  usage: number;
  remaining: number;
  error?: string;
}

export async function GET(): Promise<NextResponse<OpenRouterCreditsResponse>> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      available: false,
      limit: 0,
      usage: 0,
      remaining: 0,
      error: 'OPENROUTER_API_KEY not configured',
    });
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return NextResponse.json({
        available: false,
        limit: 0,
        usage: 0,
        remaining: 0,
        error: `OpenRouter returned ${res.status}`,
      });
    }

    const { data } = await res.json() as { data: { limit: number; usage: number; limit_remaining: number } };

    return NextResponse.json({
      available: true,
      limit: data.limit,
      usage: data.usage,
      remaining: data.limit_remaining,
    });
  } catch (err: unknown) {
    return NextResponse.json({
      available: false,
      limit: 0,
      usage: 0,
      remaining: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

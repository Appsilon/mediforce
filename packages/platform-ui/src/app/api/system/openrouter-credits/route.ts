import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, callerCanAccess } from '@/lib/api-auth';
import { OpenRouterCreditsInputSchema, type OpenRouterCreditsOutput } from '@mediforce/platform-api/contract';

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

    const body = await res.json() as { data?: { limit?: number; usage?: number; limit_remaining?: number } };
    const data = body?.data;
    if (!data || typeof data.limit_remaining !== 'number') {
      return { ...EMPTY, error: 'Unexpected response shape from OpenRouter' };
    }
    return { available: true, limit: data.limit ?? 0, usage: data.usage ?? 0, remaining: data.limit_remaining };
  } catch (err: unknown) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const parsed = OpenRouterCreditsInputSchema.safeParse({
    namespace: req.nextUrl.searchParams.get('namespace'),
  });
  if (!parsed.success) {
    return NextResponse.json({ ...EMPTY, error: 'namespace query param is required' }, { status: 400 });
  }

  const { namespace } = parsed.data;
  const { namespaceRepo, namespaceSecretsRepo } = getPlatformServices();

  const caller = await resolveCallerIdentity(req, namespaceRepo);
  if (caller instanceof NextResponse) return caller;
  if (!callerCanAccess(caller, namespace)) {
    return NextResponse.json({ ...EMPTY, error: 'Forbidden' }, { status: 403 });
  }

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

import { NextResponse } from 'next/server';
import { pingRedis } from '@mediforce/agent-queue';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  if (!process.env.REDIS_URL) {
    return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 });
  }

  try {
    const result = await pingRedis();
    return NextResponse.json({ status: 'ok', ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

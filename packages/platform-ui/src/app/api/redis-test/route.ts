import { NextResponse } from 'next/server';
import Redis from 'ioredis';

export async function GET(): Promise<NextResponse> {
  const url = process.env.REDIS_URL ?? 'not set';

  if (url === 'not set') {
    return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 });
  }

  try {
    const parsed = new URL(url);
    const isTLS = parsed.protocol === 'rediss:';

    const redis = new Redis({
      host: parsed.hostname,
      port: Number(parsed.port) || 6379,
      password: parsed.password || undefined,
      tls: isTLS ? { rejectUnauthorized: false } : undefined,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    await redis.connect();
    const pong = await redis.ping();
    await redis.disconnect();

    return NextResponse.json({
      status: 'ok',
      pong,
      host: parsed.hostname,
      port: parsed.port,
      tls: isTLS,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), redisUrl: url.replace(/:[^:@]+@/, ':***@') },
      { status: 500 },
    );
  }
}

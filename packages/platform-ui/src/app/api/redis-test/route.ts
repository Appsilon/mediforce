import { NextResponse } from 'next/server';
import { getRedisConnection } from '@mediforce/agent-queue';

export async function GET(): Promise<NextResponse> {
  const url = process.env.REDIS_URL ?? 'not set';

  if (url === 'not set') {
    return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 });
  }

  try {
    const connection = getRedisConnection();

    // Dynamic import to avoid type issues — bullmq is a transitive dep via agent-queue
    const { Queue } = await import('bullmq');
    const queue = new Queue('redis-test-ping', { connection });
    const client = await queue.client;
    const pong = await client.ping();
    await queue.close();

    return NextResponse.json({
      status: 'ok',
      pong,
      host: connection.host,
      port: connection.port,
      tls: !!connection.tls,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), redisUrl: url.replace(/:[^:@]+@/, ':***@') },
      { status: 500 },
    );
  }
}

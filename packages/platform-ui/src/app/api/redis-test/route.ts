import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function parseRedisUrl(url: string) {
  const match = url.match(/^(rediss?):\/\/(?:([^:]*):([^@]*)@)?([^:/?#]+)(?::(\d+))?/);
  if (!match) {
    throw new Error(`Could not parse REDIS_URL: ${url.replace(/:[^:@]+@/, ':***@')}`);
  }
  const [, protocol, username, password, host, portStr] = match;
  return {
    host,
    port: portStr ? Number(portStr) : 6379,
    password: password ? decodeURIComponent(password) : undefined,
    username: username ? decodeURIComponent(username) : undefined,
    tls: protocol === 'rediss' ? { rejectUnauthorized: false } : undefined,
  };
}

export async function GET(): Promise<NextResponse> {
  if (!process.env.REDIS_URL) {
    return NextResponse.json({ error: 'REDIS_URL not set' }, { status: 500 });
  }

  try {
    const connection = parseRedisUrl(process.env.REDIS_URL);
    const { Queue } = await import('bullmq');
    const queue = new Queue('redis-health-ping', { connection });
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
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

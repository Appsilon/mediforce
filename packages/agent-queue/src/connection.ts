import type { ConnectionOptions } from 'bullmq';

/**
 * Parse REDIS_URL into BullMQ connection options.
 * Supports redis://host:port format. Defaults to localhost:6379.
 */
export function getRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

  try {
    const parsed = new URL(url);
    const options: ConnectionOptions = {
      host: parsed.hostname || 'localhost',
      port: parsed.port ? Number(parsed.port) : 6379,
      password: parsed.password || undefined,
      username: parsed.username || undefined,
    };
    if (parsed.protocol === 'rediss:') {
      options.tls = { rejectUnauthorized: false };
    }
    return options;
  } catch {
    // Fallback for bare host:port
    return { host: 'localhost', port: 6379 };
  }
}

/** Quick health check — connects, PINGs, disconnects. */
export async function pingRedis(): Promise<{ pong: string; host: string; port: number; tls: boolean }> {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const parsed = new URL(url);
  const host = parsed.hostname || 'localhost';
  const port = parsed.port ? Number(parsed.port) : 6379;
  const tls = parsed.protocol === 'rediss:';

  const connection = getRedisConnection();
  const { Queue } = await import('bullmq');
  const queue = new Queue('redis-health-ping', { connection });
  const client = await queue.client;
  const pong = await client.ping();
  await queue.close();
  return { pong, host, port, tls };
}

export interface RedisConnectionInfo {
  host: string;
  port: number;
  password: string | undefined;
  username: string | undefined;
  tls: { rejectUnauthorized: boolean } | undefined;
}

/**
 * Parse REDIS_URL into connection options.
 * Parses manually because new URL() breaks when the password contains / or +.
 */
export function getRedisConnection(): RedisConnectionInfo {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL environment variable is not set');
  }

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

/** Quick health check — connects, PINGs, disconnects. */
export async function pingRedis(): Promise<{ pong: string; host: string; port: number; tls: boolean }> {
  const connection = getRedisConnection();
  const { Queue } = await import('bullmq');
  const queue = new Queue('redis-health-ping', { connection });
  const client = await queue.client;
  const pong = await client.ping();
  await queue.close();
  return {
    pong,
    host: connection.host,
    port: connection.port,
    tls: !!connection.tls,
  };
}

import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  url?: string;
  poolMax?: number;
  schema?: string;
}

/** Build a fresh Postgres client + drizzle db. Tests use this to create
 *  per-suite pools with a `search_path` override. Production code goes
 *  through `getSharedPostgresClient()` so every PG-backed repository
 *  shares one connection pool. */
export function createPostgresClient(opts: CreateDatabaseOptions = {}): {
  client: ReturnType<typeof postgres>;
  db: Database;
} {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Set it before constructing a Postgres-backed repository.',
    );
  }
  const poolMax = opts.poolMax ?? Number(process.env.DATABASE_POOL_MAX ?? '10');
  const client = postgres(url, {
    max: poolMax,
    onnotice: () => {},
    ...(opts.schema ? { connection: { search_path: opts.schema } } : {}),
  });
  const db = drizzle(client, { schema });
  return { client, db };
}

let sharedClient: { client: ReturnType<typeof postgres>; db: Database } | null = null;

/** Process-wide singleton Postgres client. Every production repository
 *  shares this pool — without it, each `new XRepository(createPostgresClient().db)`
 *  would open its own pool and a 14-repo deployment would blow past
 *  Postgres' default `max_connections=100`. */
export function getSharedPostgresClient(): { client: ReturnType<typeof postgres>; db: Database } {
  if (sharedClient) return sharedClient;
  sharedClient = createPostgresClient();
  return sharedClient;
}

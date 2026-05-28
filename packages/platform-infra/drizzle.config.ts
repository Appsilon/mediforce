import type { Config } from 'drizzle-kit';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be set when running drizzle-kit.`);
  }
  return value;
}

export default {
  schema: './src/postgres/schema/index.ts',
  out: './src/postgres/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    // Require DATABASE_URL explicitly — defaulting to localhost would let
    // `pnpm db:generate` silently target a colleague's staging tunnel.
    url: requireEnv('DATABASE_URL'),
  },
  strict: true,
  verbose: true,
} satisfies Config;

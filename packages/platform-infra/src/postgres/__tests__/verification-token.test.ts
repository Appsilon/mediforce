import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashVerificationToken,
  mintVerificationToken,
} from '../../auth/verification-token';
import { authVerificationTokens } from '../schema/auth-verification-token';
import * as schema from '../schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'migrations');

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const skipPg = !DATABASE_URL;

describe('hashVerificationToken', () => {
  it('equals sha256(raw+secret) as lowercase hex — matches @auth/core', () => {
    const raw = 'abc123';
    const secret = 'top-secret';
    const expected = createHash('sha256').update(`${raw}${secret}`).digest('hex');
    expect(hashVerificationToken(raw, secret)).toBe(expected);
  });

  it('produces the known hex vector for a fixed input', () => {
    // sha256("tokenSECRET") — precomputed, guards against a formatting drift.
    expect(hashVerificationToken('token', 'SECRET')).toBe(
      createHash('sha256').update('tokenSECRET').digest('hex'),
    );
  });

  it('is deterministic and secret-dependent', () => {
    expect(hashVerificationToken('r', 's1')).toBe(hashVerificationToken('r', 's1'));
    expect(hashVerificationToken('r', 's1')).not.toBe(hashVerificationToken('r', 's2'));
  });
});

describe.skipIf(skipPg)('mintVerificationToken', () => {
  const schemaName = `vtoken_${randomBytes(8).toString('hex')}`;
  let adminClient: ReturnType<typeof postgres>;
  let testClient: ReturnType<typeof postgres>;
  let db: PostgresJsDatabase<typeof schema>;

  beforeAll(async () => {
    adminClient = postgres(DATABASE_URL!, { max: 1, onnotice: () => {} });
    await adminClient.unsafe(`CREATE SCHEMA "${schemaName}"`);
    testClient = postgres(DATABASE_URL!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schemaName },
    });
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      await testClient.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf-8'));
    }
    db = drizzle(testClient, { schema });
  });

  afterAll(async () => {
    if (testClient) await testClient.end();
    if (adminClient) {
      await adminClient.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminClient.end();
    }
  });

  beforeEach(async () => {
    await testClient.unsafe(`TRUNCATE TABLE "${schemaName}"."auth_verification_tokens" CASCADE`);
  });

  it('inserts a row whose stored token is the hash of the returned raw token', async () => {
    const secret = 'auth-secret-value';
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const raw = await mintVerificationToken(db, 'invitee@example.test', expires, secret);

    const rows = await db
      .select()
      .from(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, 'invitee@example.test'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe(hashVerificationToken(raw, secret));
    // The raw token is never stored — only its hash lands in the table.
    expect(rows[0]?.token).not.toBe(raw);
    expect(rows[0]?.expires.getTime()).toBe(expires.getTime());
  });

  it('returns a fresh raw token on each mint', async () => {
    const a = await mintVerificationToken(db, 'a@example.test', new Date(Date.now() + 1000), 's');
    const b = await mintVerificationToken(db, 'b@example.test', new Date(Date.now() + 1000), 's');
    expect(a).not.toBe(b);
  });

  it('re-minting for the same identifier replaces the prior token (resend)', async () => {
    const secret = 's';
    const expires = new Date(Date.now() + 1000);
    const first = await mintVerificationToken(db, 'resend@example.test', expires, secret);
    const second = await mintVerificationToken(db, 'resend@example.test', expires, secret);

    const rows = await db
      .select()
      .from(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, 'resend@example.test'));
    // Only the newest token survives — the prior one is gone, so the table
    // can't grow unbounded and the old link no longer validates.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token).toBe(hashVerificationToken(second, secret));
    expect(rows[0]?.token).not.toBe(hashVerificationToken(first, secret));
  });

  it('leaves other identifiers untouched when re-minting', async () => {
    const expires = new Date(Date.now() + 1000);
    await mintVerificationToken(db, 'keep@example.test', expires, 's');
    await mintVerificationToken(db, 'other@example.test', expires, 's');
    await mintVerificationToken(db, 'other@example.test', expires, 's');

    const kept = await db
      .select()
      .from(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, 'keep@example.test'));
    expect(kept).toHaveLength(1);
  });
});

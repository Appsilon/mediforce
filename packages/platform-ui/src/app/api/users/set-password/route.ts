import { NextResponse } from 'next/server';
import { z } from 'zod';
import { hash } from 'bcryptjs';
import { getSharedPostgresClient, setUserPasswordHash } from '@mediforce/platform-infra';
import { resolveSessionUid } from '@/lib/api-auth';

/**
 * Set the signed-in user's password (ADR-0002 §4, PR2). bcrypt-hashes the new
 * password and writes `auth_users.password_hash`, which the Credentials
 * provider then reads in `authorize`. Session-authed: a caller can only set
 * their own password. Clearing `mustChangePassword` is a separate call
 * (`/api/users/me/clear-must-change-password`) the change-password page makes
 * after this succeeds.
 */
const BodySchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters.'),
});

const BCRYPT_COST = 12;

export async function POST(request: Request): Promise<NextResponse> {
  const uid = await resolveSessionUid(request);
  if (uid === null) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
      { status: 400 },
    );
  }

  const passwordHash = await hash(parsed.data.newPassword, BCRYPT_COST);
  const { db } = getSharedPostgresClient();
  const ok = await setUserPasswordHash(db, uid, passwordHash);
  if (!ok) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

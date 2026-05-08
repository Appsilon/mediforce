/**
 * One-time migration script: generate URL-safe handles for all Firebase Auth users.
 *
 * For each user it:
 *  1. Derives a handle from their email local-part (e.g. jan.kowalski@… → jan-kowalski)
 *  2. Resolves collisions by appending -2, -3, … until the handle is unique
 *  3. Writes `handle` to `users/{uid}` in Firestore
 *  4. Creates `namespaces/{handle}` with type: 'personal'
 *  5. Creates `namespaces/{handle}/members/{uid}` with role: 'owner'
 *
 * Usage:
 *   npx tsx scripts/migrate-user-handles.ts
 *   npx tsx scripts/migrate-user-handles.ts --dry-run
 *
 * Prerequisites:
 *   GOOGLE_APPLICATION_CREDENTIALS set to a service-account key file, OR
 *   gcloud auth application-default login
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// Initialise Firebase Admin
// ---------------------------------------------------------------------------

initializeApp({
  credential: applicationDefault(),
  projectId: 'mediforce-1c761',
});

const adminAuth = getAuth();
const db = getFirestore();

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const isDryRun = process.argv.includes('--dry-run');

if (isDryRun) {
  console.log('[dry-run] No writes will be performed.\n');
}

// ---------------------------------------------------------------------------
// Handle generation
// ---------------------------------------------------------------------------

function generateHandle(email: string): string {
  const localPart = email.split('@')[0];
  return localPart
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric → dash
    .replace(/^-+|-+$/g, '');    // trim leading/trailing dashes
}

/**
 * Returns the first handle that doesn't exist in Firestore namespaces.
 * Tries `base`, then `base-2`, `base-3`, … until a free slot is found.
 * The `reservedHandles` set is updated in-place so that handles assigned
 * within this migration run are also treated as taken (important for
 * multiple users that would otherwise collide with each other).
 */
async function resolveUniqueHandle(
  base: string,
  reservedHandles: Set<string>,
): Promise<string> {
  let candidate = base;
  let suffix = 2;

  while (true) {
    if (!reservedHandles.has(candidate)) {
      // Double-check against Firestore (handles that existed before the run)
      const snap = await db.collection('namespaces').doc(candidate).get();
      if (!snap.exists) {
        reservedHandles.add(candidate);
        return candidate;
      }
      reservedHandles.add(candidate); // mark as taken for future iterations
    }
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

interface MigrationStats {
  processed: number;
  created: number;
  skipped: number;
}

async function migrate(): Promise<void> {
  const stats: MigrationStats = { processed: 0, created: 0, skipped: 0 };

  // Track handles assigned during this run to handle same-run collisions
  const reservedHandles = new Set<string>();

  // Page through all users in Firebase Auth (max 1 000 per page)
  let nextPageToken: string | undefined;

  do {
    const listResult = await adminAuth.listUsers(1000, nextPageToken);
    nextPageToken = listResult.pageToken;

    for (const userRecord of listResult.users) {
      const { uid, email, displayName } = userRecord;

      if (!email) {
        console.log(`Skipping uid=${uid} — no email address`);
        stats.processed += 1;
        stats.skipped += 1;
        continue;
      }

      // Check whether this user already has a handle
      const userDoc = await db.collection('users').doc(uid).get();
      const existingHandle =
        userDoc.exists && typeof userDoc.data()?.['handle'] === 'string'
          ? (userDoc.data()!['handle'] as string)
          : null;

      if (existingHandle !== null) {
        console.log(
          `Skipping uid=${uid} (${email}) — already has handle: ${existingHandle}`,
        );
        stats.processed += 1;
        stats.skipped += 1;
        continue;
      }

      const baseHandle = generateHandle(email);
      const handle = await resolveUniqueHandle(baseHandle, reservedHandles);

      console.log(`Processing uid=${uid} (${email}) → ${handle}`);

      if (!isDryRun) {
        const now = new Date().toISOString();
        const batch = db.batch();

        // 1. Write handle to users/{uid}
        const userRef = db.collection('users').doc(uid);
        batch.set(userRef, { handle }, { merge: true });

        // 2. Create namespaces/{handle}
        const namespaceRef = db.collection('namespaces').doc(handle);
        batch.set(namespaceRef, {
          handle,
          type: 'personal',
          displayName: displayName ?? email.split('@')[0],
          linkedUserId: uid,
          createdAt: now,
        });

        // 3. Create namespaces/{handle}/members/{uid}
        const memberRef = namespaceRef.collection('members').doc(uid);
        batch.set(memberRef, {
          uid,
          role: 'owner',
          joinedAt: now,
        });

        await batch.commit();
      }

      stats.processed += 1;
      stats.created += 1;
    }
  } while (nextPageToken !== undefined);

  console.log(
    `\nMigration complete: ${stats.processed} processed, ${stats.created} created, ${stats.skipped} skipped (already had handle)`,
  );
}

migrate().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});

import type { Firestore } from 'firebase-admin/firestore';
import { FirestoreProcessRepository } from '../firestore/process-repository.js';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

/**
 * One-time startup migration: backfill `namespace` on processInstances
 * that predate the field. Resolves namespace from the workflow definition
 * that created each instance.
 *
 * Idempotent — skips instances that already have namespace set.
 * Safe to remove once all environments have been migrated.
 */
export async function backfillInstanceNamespaces(
  db: Firestore,
  _processRepo: FirestoreProcessRepository,
): Promise<void> {
  const snapshot = await db
    .collection('processInstances')
    .where('deleted', '==', false)
    .get();

  const needsBackfill = snapshot.docs.filter((d) => {
    const data = d.data();
    return data.namespace === undefined || data.namespace === null;
  });

  if (needsBackfill.length === 0) return;

  console.log(
    `[backfill] ${needsBackfill.length} processInstances missing namespace — backfilling`,
  );

  const namespaceCache = new Map<string, string | null>();

  let updated = 0;
  for (const docSnap of needsBackfill) {
    const data = docSnap.data();
    const defName = data.definitionName as string;
    const definitionVersion = data.definitionVersion as string | number | undefined;
    const cacheKey = `${defName}:${String(definitionVersion ?? '')}`;

    if (!namespaceCache.has(cacheKey)) {
      const definitionSnapshot = await db
        .collection('workflowDefinitions')
        .where('name', '==', defName)
        .get();

      let namespace: string | null = null;
      for (const definitionDoc of definitionSnapshot.docs) {
        const parsed = WorkflowDefinitionSchema.safeParse(definitionDoc.data());
        if (!parsed.success) continue;

        const versionMatches =
          definitionVersion !== undefined &&
          definitionVersion !== null &&
          String(parsed.data.version) === String(definitionVersion);

        if (versionMatches) {
          namespace = parsed.data.namespace;
          break;
        }
      }
      namespaceCache.set(cacheKey, namespace);
    }

    const namespace = namespaceCache.get(cacheKey);
    if (namespace !== null && namespace !== undefined) {
      await db.collection('processInstances').doc(docSnap.id).update({ namespace });
      updated++;
    }
  }

  console.log(
    `[backfill] Done — ${updated} instances updated, ${needsBackfill.length - updated} skipped (no workflow definition found)`,
  );
}

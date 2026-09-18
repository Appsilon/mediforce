import { DEFAULT_IMAGE_CATALOG_ENTRIES, ImageCatalogEntrySchema } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { deriveImageCatalogEntryId } from './_source';

/**
 * Put the images a step falls back to when it names none into a workspace's
 * catalog (#1376).
 *
 * This runs after workspace creation and is best-effort. It never probes the
 * daemon, and preserves a workspace member's edits to an existing default.
 *
 * Returns the rows actually written, not the defaults covered: a re-seed of a
 * workspace that already holds all five reports 0, so the backfill script says
 * what it changed rather than reporting five writes it did not make.
 */
export async function seedDefaultImageCatalogEntries(
  namespace: string,
  scope: CallerScope,
): Promise<number> {
  let seeded = 0;
  for (const seed of DEFAULT_IMAGE_CATALOG_ENTRIES) {
    try {
      const source = { kind: 'referenced' as const, reference: seed.reference };
      const entry = ImageCatalogEntrySchema.parse({
        id: deriveImageCatalogEntryId(source),
        name: seed.reference,
        intent: seed.intent,
        source,
      });
      const existing = await scope.system.imageCatalog.getById(namespace, entry.id);
      if (existing === null) {
        // The caller's memberships were resolved before this workspace existed.
        await scope.system.imageCatalog.upsert(namespace, entry);
        seeded += 1;
      }
    } catch {
      continue;
    }
  }
  return seeded;
}

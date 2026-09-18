import { DEFAULT_IMAGE_CATALOG_ENTRIES } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  SeedImageCatalogEntriesInput,
  SeedImageCatalogEntriesOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { seedDefaultImageCatalogEntries } from './_seed';

/**
 * Seed a workspace's catalog with the engine defaults (#1376).
 *
 * Every workspace gets these at creation. This is the handle for the ones
 * created before seeding existed, and for a workspace whose seed failed
 * against an outage — the backfill script and a member retrying both land
 * here rather than re-typing five `images create` calls with the sentences
 * copied out of `platform-core`.
 *
 * A member's right, like `create`: it writes rows naming image strings the
 * same member can already type into the step editor (ADR-0022 decision 3).
 */
export async function seedImageCatalogEntries(
  input: SeedImageCatalogEntriesInput,
  scope: CallerScope,
): Promise<SeedImageCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  // An apiKey caller bypasses the gate above, so a mistyped handle would
  // otherwise write five rows into a workspace nobody can open.
  if ((await scope.workspaces.getNamespace(input.namespace)) === null) {
    throw new NotFoundError(`Namespace '${input.namespace}' not found`);
  }

  const seeded = await seedDefaultImageCatalogEntries(input.namespace, scope);

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog.seeded',
    description: `Seeded ${String(seeded)} default image catalog entries in namespace '${input.namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace: input.namespace },
    outputSnapshot: { seeded, expected: DEFAULT_IMAGE_CATALOG_ENTRIES.length },
    basis: 'Default image catalog entries seeded via API',
    entityType: 'namespace',
    entityId: input.namespace,
    namespace: input.namespace,
  });

  return { seeded };
}

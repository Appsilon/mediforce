import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListImageCatalogEntriesInput,
  ListImageCatalogEntriesOutput,
} from '../../contract/image-catalog';
import { fetchDaemonImages } from '../system/_docker';
import { forgetRemovedImages, probeInBackground, withProbedCapabilities } from './_capabilities';
import { discoverEntries } from './_discovered';
import { toEntryViews } from './_view';
import { orderByLineage } from './_lineage';

export async function listImageCatalogEntries(
  input: ListImageCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListImageCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const rows = await scope.imageCatalog.list(input.namespace);

  // One daemon read for the whole response. Discovery is arithmetic over the
  // listing the entry views need anyway, so offering every source this
  // namespace built costs no extra call and no write of its own.
  // An unreachable daemon discovers nothing rather than reading a listing it
  // could not produce — the same guard `toEntryViews` applies to the versions.
  const daemon = await fetchDaemonImages();
  const images = daemon.available ? daemon.images : [];
  // Only a listing the daemon produced says what is gone; an outage says nothing.
  if (daemon.available) forgetRemovedImages(daemon.images);
  // Every answer this process already holds, whichever workspace paid for it —
  // a discovered entry has no row, and a stored one's row may predate the build.
  const stored = rows.map((entry) => withProbedCapabilities(input.namespace, entry, images));
  const discovered = discoverEntries(input.namespace, images, rows).map((entry) =>
    withProbedCapabilities(input.namespace, entry, images),
  );
  const catalog = [...stored, ...discovered];

  // Whatever is still unanswered is probed off the request, one image at a
  // time, and shows on the next poll. The listing never waits for a container,
  // and never queues the same image twice.
  probeInBackground(input.namespace, catalog, images);

  // Grouped by base rather than listed flat: the estate is a tree — the golden
  // image and everything built on it — and four unrelated rows is what the
  // catalog exists to stop showing (ADR-0022 decision 2, #1296). Discovered
  // entries group by the same rule, so an image the platform just built lands
  // under the image it was built on rather than in a lost-property section.
  return {
    entries: orderByLineage([
      ...(await toEntryViews(input.namespace, stored, catalog, daemon)),
      ...(await toEntryViews(input.namespace, discovered, catalog, daemon, 'discovered')),
    ]),
  };
}

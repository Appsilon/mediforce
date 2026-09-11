import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  ListImageCatalogEntriesInput,
  ListImageCatalogEntriesOutput,
} from '../../contract/image-catalog';
import { fetchDaemonImages } from '../system/_docker';
import { memoisedCapabilities } from './_capabilities';
import { discoverEntries } from './_discovered';
import { toEntryViews } from './_view';
import { orderByLineage } from './_lineage';

export async function listImageCatalogEntries(
  input: ListImageCatalogEntriesInput,
  scope: CallerScope,
): Promise<ListImageCatalogEntriesOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const stored = await scope.imageCatalog.list(input.namespace);

  // One daemon read for the whole response. Discovery is arithmetic over the
  // listing the entry views need anyway, so offering every source this
  // namespace built costs no extra call, no probe and no write — which is what
  // makes it affordable on a listing polled every 30 seconds.
  // An unreachable daemon discovers nothing rather than reading a listing it
  // could not produce — the same guard `toEntryViews` applies to the versions.
  const daemon = await fetchDaemonImages();
  const images = daemon.available ? daemon.images : [];
  // Whatever a single-entry read has already probed. The listing pays for no
  // probe of its own — a container per version on a 30 s poll — but a stored
  // entry shows the answer its row holds, and a discovered one should not read
  // as unprobed just because its answer lives in a memo instead.
  const discovered = discoverEntries(input.namespace, images, stored).map((entry) => ({
    ...entry,
    capabilities: memoisedCapabilities(entry, images),
  }));
  const catalog = [...stored, ...discovered];

  // Grouped by base rather than listed flat: the estate is a tree — the golden
  // image and everything built on it — and four unrelated rows is what the
  // catalog exists to stop showing (ADR-0022 decision 2, #1296). Discovered
  // entries group by the same rule, so an image the platform just built lands
  // under the image it was built on rather than in a lost-property section.
  return {
    entries: orderByLineage([
      ...(await toEntryViews(stored, catalog, daemon)),
      ...(await toEntryViews(discovered, catalog, daemon, 'discovered')),
    ]),
  };
}

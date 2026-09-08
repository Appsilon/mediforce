import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  GetImageCatalogEntryInput,
  GetImageCatalogEntryOutput,
} from '../../contract/image-catalog';
import { fetchDaemonImages } from '../system/_docker';
import { discoverEntries } from './_discovered';
import { toEntryView, toEntryViews } from './_view';
import { withBuildSteps } from './_lineage';
import { probeDiscoveredCapabilities, refreshEntryCapabilities } from './_capabilities';

export async function getImageCatalogEntry(
  input: GetImageCatalogEntryInput,
  scope: CallerScope,
): Promise<GetImageCatalogEntryOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const entry = await scope.imageCatalog.getById(input.namespace, input.id);
  const daemon = await fetchDaemonImages();

  // Not a row, so not a 404: an image this namespace built and nobody has
  // described yet is offered by the listing, and a reader who clicks it must
  // reach the same entry the listing showed them.
  if (entry === null) {
    const images = daemon.available ? daemon.images : [];
    const stored = await scope.imageCatalog.list(input.namespace);
    const discovered = discoverEntries(input.namespace, images, stored);
    const found = discovered.find((candidate) => candidate.id === input.id);
    if (found === undefined) {
      throw new NotFoundError(`Image catalog entry '${input.id}' not found`);
    }
    // Probed exactly like a stored entry on this read, into the memo a row
    // would otherwise hold: nothing about a discovered entry is meant to be
    // less derived than a catalogued one, and capabilities are the only fact
    // that costs a container rather than arithmetic.
    const probed = { ...found, capabilities: await probeDiscoveredCapabilities(found, images) };
    const [view] = await toEntryViews(
      [probed],
      [...stored, ...discovered],
      daemon,
      'discovered',
    );
    return { entry: await withBuildSteps(view) };
  }

  // Probe whatever has never been probed, then render. Capabilities used to be
  // refreshed only on create and update, which left the ordinary build-mode
  // sequence — catalogue the entry, build the image on the first run — showing
  // "Capabilities not probed" for ever, since no write ever followed the build.
  // Reading one entry is the user-initiated, one-at-a-time moment where paying
  // for a probe is affordable; the listing deliberately still does not, because
  // that would probe a whole catalog on every poll.
  const probed = await refreshEntryCapabilities(input.namespace, entry, scope, daemon, {
    unattemptedOnly: true,
  });

  // An entry whose image is gone from the daemon is not a 404: the sentence
  // someone wrote about it is still the answer to "what was this for?".
  const view = await toEntryView(input.namespace, probed, scope, daemon);
  // The layer delta costs a `docker history` per version, so it is attached
  // here and not on the listing — one entry at a time is what it is for.
  return { entry: await withBuildSteps(view) };
}

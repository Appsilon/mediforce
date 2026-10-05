import { normalizeImageRef } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  CheckImageCommandInput,
  CheckImageCommandOutput,
} from '../../contract/image-catalog';
import { fetchDaemonImages, probeImageCommand } from '../system/_docker';
import { discoverEntries } from './_discovered';
import { resolveEntryVersions } from './_versions';

/**
 * Settled answers by `imageId` and command. An image id is content-addressed,
 * so a rebuild is a different key and an answer cannot go stale; one probe then
 * serves every workspace. `unknown` is never stored — nothing was learned, and
 * the next ask may reach a daemon that answers.
 */
const settled = new Map<string, CheckImageCommandOutput>();

/** Asks in flight, so concurrent first asks share one container. */
const pending = new Map<string, Promise<CheckImageCommandOutput>>();

/** One probe at a time: each is a container start on the shared host, and a
 *  member can ask about any number of distinct commands. */
let probeQueue: Promise<unknown> = Promise.resolve();

export function clearImageCommandChecks(): void {
  settled.clear();
  pending.clear();
  probeQueue = Promise.resolve();
}

/** Bound the settled answers by what the daemon holds: an id it no longer
 *  lists is a rebuilt or deleted image, and its answers can never be asked for. */
function forgetRemovedImageChecks(imageIds: ReadonlySet<string>): void {
  for (const key of settled.keys()) {
    if (!imageIds.has(key.slice(0, key.indexOf('\u0000')))) settled.delete(key);
  }
}

/**
 * Whether one image resolves one command — the question an MCP catalog entry
 * raises when its `command` is `uvx` and the image it runs in is not known to
 * carry it. Advisory (ADR-0022): the caller warns, nothing is refused.
 *
 * The image must be a version of an entry in the caller's own catalog (stored
 * or discovered, ADR-0022 decision 1) that the daemon lists, so a caller-supplied
 * string never reaches `docker run` as anything but an image reference we have
 * seen, and one workspace cannot probe another's images. An
 * image the daemon does not hold (the default one before its first build) is
 * `unknown`, not an error: nobody could answer.
 */
export async function checkImageCommand(
  input: CheckImageCommandInput,
  scope: CallerScope,
): Promise<CheckImageCommandOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);

  const daemon = await fetchDaemonImages();
  if (!daemon.available) return { status: 'unknown' };

  const rows = await scope.imageCatalog.list(input.namespace);
  const catalog = [...rows, ...discoverEntries(input.namespace, daemon.images, rows)];
  const wanted = normalizeImageRef(input.image);
  const image = catalog
    .flatMap((entry) => resolveEntryVersions(input.namespace, entry.source, daemon.images))
    .find((version) => normalizeImageRef(version.imageTag) === wanted);
  if (image === undefined) return { status: 'unknown' };
  const reference = image.imageTag;

  forgetRemovedImageChecks(new Set(daemon.images.map((listed) => listed.id)));

  const key = `${image.imageId}\u0000${input.command}`;
  const cached = settled.get(key);
  if (cached !== undefined) return cached;

  const inFlight = pending.get(key);
  if (inFlight !== undefined) return inFlight;

  const turn = probeQueue.then(() => probeImageCommand(reference, input.command));
  probeQueue = turn.catch(() => undefined);
  const probing = turn
    .then((answer) => {
      if (answer.status === 'known') settled.set(key, answer);
      return answer;
    })
    .finally(() => pending.delete(key));
  pending.set(key, probing);
  return probing;
}

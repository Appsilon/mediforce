import { assertNamespaceAccess } from '../../auth';
import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  CheckImageCommandInput,
  CheckImageCommandOutput,
} from '../../contract/image-catalog';
import { fetchDaemonImages, probeImageCommand } from '../system/_docker';

/**
 * Settled answers by `imageId` and command. An image id is content-addressed,
 * so a rebuild is a different key and an answer cannot go stale; one probe then
 * serves every workspace. `unknown` is never stored — nothing was learned, and
 * the next ask may reach a daemon that answers.
 */
const settled = new Map<string, CheckImageCommandOutput>();

/** Asks in flight, so concurrent first asks share one container. */
const pending = new Map<string, Promise<CheckImageCommandOutput>>();

export function clearImageCommandChecks(): void {
  settled.clear();
  pending.clear();
}

/**
 * Whether one image resolves one command — the question an MCP catalog entry
 * raises when its `command` is `uvx` and the image it runs in is not known to
 * carry it. Advisory (ADR-0022): the caller warns, nothing is refused.
 *
 * The image must be one the daemon lists, so a caller-supplied string never
 * reaches `docker run` as anything but an image reference we have seen.
 */
export async function checkImageCommand(
  input: CheckImageCommandInput,
  scope: CallerScope,
): Promise<CheckImageCommandOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);

  const daemon = await fetchDaemonImages();
  if (!daemon.available) return { status: 'unknown' };

  const reference = input.image.includes(':') ? input.image : `${input.image}:latest`;
  const image = daemon.images.find((candidate) => `${candidate.repository}:${candidate.tag}` === reference);
  if (image === undefined) {
    throw new NotFoundError(`Image '${input.image}' is not on the daemon`);
  }

  const key = `${image.id}\u0000${input.command}`;
  const cached = settled.get(key);
  if (cached !== undefined) return cached;

  const inFlight = pending.get(key);
  if (inFlight !== undefined) return inFlight;

  const probing = probeImageCommand(reference, input.command)
    .then((answer) => {
      if (answer.status === 'known') settled.set(key, answer);
      return answer;
    })
    .finally(() => pending.delete(key));
  pending.set(key, probing);
  return probing;
}

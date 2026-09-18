import { normalizeImageRef, shortImageId } from '@mediforce/platform-core';
import { assertCallerCanAdminDockerImages } from '../../auth';
import { emitAudit } from '../../audit-helpers';
import { PreconditionFailedError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  DeleteDockerImageInput,
  DeleteDockerImageOutput,
} from '../../contract/docker-images';
import { fetchDaemonImages } from '../system/_docker';
import { assertNoLiveImagePins } from '../workflows/_image-pins';

/** A reference that *may* name an image by id rather than by repository and
 *  tag — `docker rmi` accepts any unambiguous prefix, with or without the
 *  algorithm. Only "may": `facade` is a legal repository name and legal hex,
 *  and nothing in the reference distinguishes them, which is why the id
 *  reading widens the scan rather than replacing it. */
const IMAGE_ID_REFERENCE = /^(?:sha256:)?[0-9a-f]{6,64}$/;

/**
 * Every tag a delete of `imageId` would take with it, and whether that answer
 * is complete.
 *
 * `imageId` is an id or a `name:tag` — both have always been accepted — while
 * the pin scan asks about tags. The reference itself is always a needle:
 * `docker rmi foo` removes `foo:latest`, and that holds whatever the daemon
 * says. An id carries no tag of its own, so its tags have to be read off the
 * daemon listing, and `docker rmi <id>` takes all of them — a scan that weighed
 * only the first would miss a step pinned to the second.
 *
 * `complete: false` is a listing that could not be read, not an image with no
 * tags. `fetchDaemonImages` degrades an unreachable daemon to an empty listing
 * (ADR-0022 decision 2), which is the right answer for a read and, taken at
 * face value here, the same fail-open this check exists to close (#1375). The
 * caller decides what to do about it, so a reference that is pinned outright
 * still gets the refusal that names the workflow.
 */
async function tagsNamedBy(
  imageId: string,
): Promise<{ tags: string[]; complete: boolean }> {
  const tags = new Set<string>([normalizeImageRef(imageId)]);
  if (!IMAGE_ID_REFERENCE.test(imageId)) return { tags: [...tags], complete: true };

  const listing = await fetchDaemonImages();
  for (const image of listing.images) {
    if (image.repository === '<none>' || image.tag === '<none>') continue;
    if (!shortImageId(image.id).startsWith(shortImageId(imageId))) continue;
    tags.add(`${image.repository}:${image.tag}`);
  }
  return { tags: [...tags], complete: listing.available };
}

export async function deleteDockerImage(
  input: DeleteDockerImageInput,
  scope: CallerScope,
): Promise<DeleteDockerImageOutput> {
  assertCallerCanAdminDockerImages(scope.caller);

  const deleter = scope.system.dockerImages;
  if (deleter === null) {
    throw new PreconditionFailedError(
      'Docker image deletion is not configured in this deployment',
    );
  }

  // The gate above is documented as a loose approximation — owner or admin of
  // *any* namespace — which nearly every user satisfies through their own
  // personal workspace, while the daemon behind this is deployment-wide. So
  // what stands between a stray `mediforce system rmi` and 400 steps failing
  // at container start is this check, not the gate (#1375). It reads every
  // definition in the deployment, which is what makes it sound and what makes
  // it worth doing once per image rather than once per caller.
  const named = await tagsNamedBy(input.imageId);
  await assertNoLiveImagePins(named.tags, scope);
  if (named.complete === false) {
    // The scan above cleared what this reference names; it could not see the
    // other tags the same id carries, and refusing beats guessing at them.
    // `system rmi` can name the image as `repository:tag` instead, which needs
    // no listing; Admin → Infrastructure has only the id, and a retry once the
    // daemon answers is the way through.
    throw new PreconditionFailedError(
      'Cannot tell which workflows run on this image: the daemon image listing is unavailable, ' +
        'so the other tags on this image id cannot be checked. Retry, or delete it as repository:tag.',
    );
  }

  const result = await deleter.delete(input.imageId);

  await emitAudit(scope.system.audit, scope.caller, {
    action: 'docker_image.deleted',
    namespace: '_system',
    description: `Deleted docker image ${input.imageId}`,
    entityType: 'docker_image',
    entityId: input.imageId,
    basis: 'api-call',
    inputSnapshot: { imageId: input.imageId },
    outputSnapshot: { ...result },
  });

  return result;
}

import { deriveBuildTag } from '@mediforce/agent-runtime';
import { normalizeRepoUrls } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { HandlerError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  BuildImageCatalogVersionInput,
  BuildImageCatalogVersionOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { buildImage } from '../system/_docker';
import { canonicalizeSource, deriveImageCatalogEntryId } from './_source';

/**
 * Build one version of a catalogued source, without running a workflow.
 *
 * The platform could already build this exact image — a build-mode step does it
 * lazily at run time — but only as a side effect of a run, which leaves a user
 * preparing an image with nothing to do and, on a deployment with no registry
 * and no host shell, no way in at all (#1344).
 *
 * Everything here is the auto-build path with the run taken out: the same
 * `deriveBuildTag`, the same builder, the same provenance labels. That is what
 * makes the result indistinguishable from a step's own build — a step pinning
 * this commit finds it cached rather than rebuilding it — and what lets the
 * catalog pick it up with no code of its own (ADR-0022 decisions 1 and 7).
 */
export async function buildImageCatalogVersion(
  input: BuildImageCatalogVersionInput,
  scope: CallerScope,
): Promise<BuildImageCatalogVersionOutput> {
  // Any workspace member, matching `createImageCatalogEntry`. A build runs a
  // Dockerfile on the shared host, which reads like an admin operation — but
  // the same member can already trigger the same build on the same host by
  // running a build-mode step, so gating here would remove the convenient path
  // and not the capability. Privileging host-side builds is a decision about
  // build-mode steps generally, not one to introduce asymmetrically here.
  assertNamespaceAccess(scope.caller, input.namespace);

  const source = canonicalizeSource({
    kind: 'built',
    repo: input.repo,
    dockerfile: input.dockerfile,
  });
  if (source.kind !== 'built') {
    throw new HandlerError('validation', 'A build needs a built source.');
  }

  // The canonical repo is what the entry is keyed on and what the tag hashes,
  // so both sides of "did this build land under the entry" use one value.
  const repoUrl = normalizeRepoUrls(source.repo).gitUrl;
  const imageTag = deriveBuildTag(repoUrl, input.commit, source.dockerfile);
  const entryId = deriveImageCatalogEntryId(source);

  try {
    await buildImage({
      image: imageTag,
      repoUrl,
      repoRef: input.repo,
      commit: input.commit,
      dockerfile: source.dockerfile,
      namespace: input.namespace,
    });
  } catch (error) {
    // Never degraded to a success with an `unknown` field: the caller asked for
    // an image to exist, and a build that failed silently would leave them
    // polling a catalog entry that is never going to gain a version.
    throw new HandlerError(
      'internal',
      `Building "${imageTag}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const actor = actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.version_built',
    description: `Image '${imageTag}' built for entry '${entryId}' in namespace '${input.namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace: input.namespace,
      repo: source.repo,
      dockerfile: source.dockerfile,
      commit: input.commit,
    },
    outputSnapshot: { imageTag, entryId },
    basis: 'Image built on demand via API',
    entityType: 'imageCatalogEntry',
    entityId: entryId,
    namespace: input.namespace,
  });

  return { imageTag, entryId };
}

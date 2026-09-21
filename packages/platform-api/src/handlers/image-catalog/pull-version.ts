import { daemonRepositoryName } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import type { CallerScope } from '../../repositories/index';
import type {
  PullImageCatalogVersionInput,
  PullImageCatalogVersionOutput,
} from '../../contract/image-catalog';
import { pullImage } from '../system/_docker';
import { addReferencedVersion, assertReferenceNotAnotherWorkspaces } from './_referenced-version';

/**
 * Pull a registry image onto the daemon and catalogue it as a version of a
 * `referenced` entry, created by the reference's first pull (ADR-0022).
 */
export async function pullImageCatalogVersion(
  input: PullImageCatalogVersionInput,
  scope: CallerScope,
): Promise<PullImageCatalogVersionOutput> {
  // Any workspace member, as for an upload: a step naming the same image
  // already pulls it on its first run.
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace } = input;
  const reference = daemonRepositoryName(input.reference);

  await assertReferenceNotAnotherWorkspaces(reference, namespace, scope);

  const tag = input.tag ?? 'latest';
  return addReferencedVersion(
    { namespace, reference, tag, name: input.name, intent: input.intent },
    scope,
    {
      act: 'pull',
      produce: (image) => pullImage({ image }),
      versionAudit: (image, entryId) => ({
        action: 'image_catalog_entry.version_pulled',
        description: `Image '${image}' pulled from its registry for entry '${entryId}' in namespace '${namespace}'`,
        inputSnapshot: { namespace, reference: input.reference, tag },
        basis: 'Registry image pulled via API',
      }),
    },
  );
}

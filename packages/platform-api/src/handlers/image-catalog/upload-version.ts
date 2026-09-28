import { checkBuildContextArchive } from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { PayloadTooLargeError, ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  UploadImageCatalogVersionInput,
  UploadImageCatalogVersionOutput,
} from '../../contract/image-catalog';
import { buildUploadedImage } from '../system/_docker';
import { addReferencedVersion } from './_referenced-version';

/** `20260911-140437` — sortable, readable, and never a tag someone typed. */
function uploadTimeTag(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

/**
 * Build an image from an uploaded context and catalogue it as a `referenced`
 * entry, created by the reference's first upload (#1345, ADR-0022).
 */
export async function uploadImageCatalogVersion(
  input: UploadImageCatalogVersionInput,
  scope: CallerScope,
): Promise<UploadImageCatalogVersionOutput> {
  // Any workspace member, as for a repo build (ADR-0022).
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace, reference, dockerfile, context } = input;

  const check = checkBuildContextArchive(context, dockerfile);
  if (check.ok === false) {
    throw check.reason === 'too_large'
      ? new PayloadTooLargeError(check.message)
      : new ValidationError(check.message);
  }

  const tag = input.tag ?? uploadTimeTag(new Date());
  return addReferencedVersion(
    {
      namespace,
      reference,
      tag,
      name: input.name,
      intent: input.intent,
      declaredSource: input.declaredSource,
    },
    scope,
    {
      act: 'upload',
      produce: (image) => buildUploadedImage({ image, dockerfile, namespace }, context),
      versionAudit: (image, entryId) => ({
        action: 'image_catalog_entry.version_uploaded',
        description: `Image '${image}' built from an uploaded context for entry '${entryId}' in namespace '${namespace}'`,
        inputSnapshot: { namespace, reference, tag, dockerfile, contextBytes: context.length },
        basis: 'Image built from an uploaded build context via API',
      }),
    },
  );
}

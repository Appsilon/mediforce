import { checkBuildContextSize } from '@mediforce/platform-core';
import { uploadImageCatalogVersion } from '@mediforce/platform-api/handlers';
import { UploadImageCatalogVersionInputSchema } from '@mediforce/platform-api/contract';
import { PayloadTooLargeError, ValidationError } from '@mediforce/platform-api/errors';
import { createMultipartRouteAdapter } from '@/lib/route-adapter';

/**
 * POST /api/image-catalog/upload?namespace=… — `uploadImageCatalogVersion`
 * (#1345). The build context archive as "context", the rest as JSON in "input".
 */
export const POST = createMultipartRouteAdapter(
  async (form, req) => {
    const archive = form.get('context');
    if (archive instanceof File === false) {
      throw new ValidationError('context field is required: the build context as a tar archive');
    }
    // Refused before it is copied out of the form: the handler checks again.
    const size = checkBuildContextSize(archive.size);
    if (size.ok === false) throw new PayloadTooLargeError(size.message);

    let fields: unknown;
    try {
      fields = JSON.parse(String(form.get('input') ?? '{}'));
    } catch {
      throw new ValidationError('input field must be JSON');
    }

    const parsed = UploadImageCatalogVersionInputSchema.safeParse({
      ...(typeof fields === 'object' && fields !== null ? fields : {}),
      namespace: new URL(req.url).searchParams.get('namespace') ?? '',
      context: new Uint8Array(await archive.arrayBuffer()),
    });
    if (parsed.success === false) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input', parsed.error.issues);
    }
    return parsed.data;
  },
  uploadImageCatalogVersion,
  {
    logTag: 'image-catalog-upload-route',
    unreadableBodyMessage: 'Could not read the upload. The build context may exceed the maximum upload size.',
  },
);

/** The build runs inside the request, as a repo build's does. */
export const maxDuration = 1800;

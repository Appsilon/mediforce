import { NextResponse } from 'next/server';
import { findWorkflowImagePins } from '@mediforce/platform-api/handlers';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity } from '@/lib/api-auth';

/**
 * Which workflows pin the given images — the "used by" answer.
 *
 * `scope=all` widens it from *what would break* to *everything that mentions
 * these images*: every version rather than the live one, archived workflows
 * included. The delete flow in the Image Catalog needs that wider answer,
 * because the narrow one hides the history a reader must see before destroying
 * an artifact. Everything else wants the narrow one, since a superseded version
 * is not a workflow anybody is running.
 *
 * The matching itself lives in `findWorkflowImagePins` so this and
 * `deleteImageCatalogEntry` cannot disagree about what counts as a pin.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const { processRepo, namespaceRepo } = getPlatformServices();
  const caller = await resolveCallerIdentity(request, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  const url = new URL(request.url);
  // Repeatable: a catalog entry accumulates a version per build and the Images
  // view asks about all of them at once, so answering one image at a time would
  // be a full scan of every workflow definition per version.
  const imageParams = url.searchParams.getAll('image').filter((value) => value.length > 0);
  if (imageParams.length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: image' },
      { status: 400 },
    );
  }
  const includeHistorical = url.searchParams.get('scope') === 'all';

  // Full scan — Firestore can't query nested steps[].agent.image. Denormalize to a top-level dockerImages[] field when scale demands it.
  const { definitions } = await processRepo.listAllWorkflowDefinitions(includeHistorical);
  const pins = findWorkflowImagePins(definitions, imageParams);

  const workflows = pins
    // A private workflow in a namespace the caller has not joined is not theirs
    // to read, even though the daemon it pins from is shared.
    .filter(
      (pin) =>
        caller.isSystemActor ||
        caller.namespaces.has(pin.namespace) ||
        pin.visibility === 'public',
    )
    .filter((pin) => includeHistorical || pin.live)
    .map(({ visibility: _visibility, ...pin }) => pin);

  return NextResponse.json({ workflows });
}

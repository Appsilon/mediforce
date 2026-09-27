import {
  imageTagTakenMessage,
  isDefaultEngineImageSource,
  isRegistryHost,
  ImageCatalogEntrySchema,
  type ImageCatalogDeclaredSource,
  type ImageCatalogEntry,
} from '@mediforce/platform-core';
import {
  ConflictError,
  ForbiddenError,
  HandlerError,
  PreconditionFailedError,
  ValidationError,
} from '../../errors';
import type { CallerScope } from '../../repositories/index';
import { actorFromCaller } from '../_helpers';
import { fetchDaemonImages } from '../system/_docker';
import { deriveImageCatalogEntryId } from './_source';
import { refreshEntryCapabilities } from './_capabilities';

/**
 * Refuse a reference whose first segment is another workspace's handle.
 *
 * `<workspace>/<name>` is the Image Catalog's naming for what a workspace
 * uploads and publishes, and the daemon is shared. Pulled or catalogued from
 * elsewhere, such a name would run there as if its own members had put it on
 * the daemon — and, catalogued, would hand the other workspace its delete.
 */
export async function assertReferenceNotAnotherWorkspaces(
  reference: string,
  namespace: string,
  scope: CallerScope,
): Promise<void> {
  // An engine default is every workspace's to catalogue (decision 8), even
  // when a workspace's handle happens to be its first segment.
  if (isDefaultEngineImageSource({ kind: 'referenced', reference })) return;
  const [owner, ...path] = reference.split('/');
  if (owner === undefined || path.length === 0 || owner === namespace || isRegistryHost(owner)) return;
  if ((await scope.workspaces.getNamespace(owner)) === null) return;
  throw new ForbiddenError(
    `"${reference}" is a name that belongs to workspace "${owner}" on this deployment: the daemon lists it as that workspace's image, so another workspace cannot pull or catalogue it.`,
  );
}

/** One version of a `referenced` entry, as an upload or a pull names it. */
export interface ReferencedVersionRequest {
  namespace: string;
  reference: string;
  tag: string;
  name?: string;
  intent?: string;
  declaredSource?: ImageCatalogDeclaredSource;
}

/** How the two acts that land a `referenced` version read in messages. */
const ACT_WORDING = {
  upload: { article: 'an', past: 'uploaded', produced: 'built', gerund: 'Building' },
  pull: { article: 'a', past: 'pulled', produced: 'pulled', gerund: 'Pulling' },
} as const;

type ReferencedAct = keyof typeof ACT_WORDING;

/** The entry a reference's first upload or pull creates, validated before the
 *  daemon is touched. */
function firstEntry(request: ReferencedVersionRequest, id: string, act: ReferencedAct): ImageCatalogEntry {
  if (request.intent === undefined) {
    throw new ValidationError(
      `intent is required the first time "${request.reference}" is ${ACT_WORDING[act].past}: one sentence saying what this image is for`,
    );
  }
  const parsed = ImageCatalogEntrySchema.safeParse({
    id,
    source: { kind: 'referenced', reference: request.reference },
    name: request.name ?? request.reference.split('/').pop(),
    intent: request.intent,
    declaredSource: request.declaredSource,
    capabilities: {},
  });
  if (parsed.success === false) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input', parsed.error.issues);
  }
  return parsed.data;
}

/** The entry fields `request` would change. A later version may repeat them but
 *  never change them: they belong to the entry, not to one version. */
function changedEntryFields(existing: ImageCatalogEntry, request: ReferencedVersionRequest): string[] {
  const declaredKeys = ['repo', 'commit', 'dockerfile'] as const;
  return [
    request.name !== undefined && request.name !== existing.name ? 'name' : null,
    request.intent !== undefined && request.intent !== existing.intent ? 'intent' : null,
    request.declaredSource !== undefined &&
    declaredKeys.some((key) => request.declaredSource?.[key] !== existing.declaredSource?.[key])
      ? 'declaredSource'
      : null,
  ].filter((field) => field !== null);
}

/**
 * Put `reference:tag` on the daemon through `produce` and catalogue it as a
 * version of the `referenced` entry keyed on `reference`, which the first
 * version creates (ADR-0022). An upload and a pull differ only in how the image
 * reaches the daemon; the entry rules are one set: a tag is never replaced, the
 * first version needs the intent sentence, and a later one may not rewrite the
 * entry.
 */
export async function addReferencedVersion(
  request: ReferencedVersionRequest,
  scope: CallerScope,
  options: {
    act: ReferencedAct;
    produce: (image: string) => Promise<void>;
    /** The audit event recording this version, beyond the entry's creation. */
    versionAudit: (image: string, entryId: string) => {
      action: string;
      description: string;
      inputSnapshot: Record<string, unknown>;
      basis: string;
    };
  },
): Promise<{ imageTag: string; entryId: string }> {
  const { namespace, reference, tag } = request;
  const wording = ACT_WORDING[options.act];

  const id = deriveImageCatalogEntryId({ kind: 'referenced', reference });
  const existing = await scope.imageCatalog.getById(namespace, id);
  const changedBefore = existing === null ? [] : changedEntryFields(existing, request);
  if (existing !== null && changedBefore.length > 0) {
    throw new ValidationError(
      `"${reference}" is already catalogued as "${existing.name}", and ${wording.article} ${options.act} only adds a version to it: ${changedBefore.join(', ')} differ from the entry. Leave them out, or edit the entry.`,
    );
  }
  const entry = existing ?? firstEntry(request, id, options.act);

  const image = `${reference}:${tag}`;

  // Checked here so a taken tag costs nothing; the worker checks again just
  // before the tag lands, for one taken meanwhile.
  const daemon = await fetchDaemonImages();
  if (daemon.available === false) {
    throw new PreconditionFailedError(
      'The Docker daemon could not be reached, so whether this tag is already taken cannot be checked.',
    );
  }
  if (daemon.images.some((row) => row.repository === reference && row.tag === tag)) {
    throw new ConflictError(imageTagTakenMessage(image, options.act));
  }

  try {
    await options.produce(image);
  } catch (error) {
    if (error instanceof HandlerError) throw error;
    throw new HandlerError(
      'internal',
      `${wording.gerund} "${image}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Re-read: another first version may have created the entry meanwhile. Its
  // fields stand, and any of this request's that differ are refused below, once
  // the version they cannot change is audited.
  const current = await scope.imageCatalog.getById(namespace, id);
  const stored = current ?? (await scope.imageCatalog.upsert(namespace, entry));
  const changedDuring = current === null ? [] : changedEntryFields(current, request);
  await refreshEntryCapabilities(namespace, stored, scope, await fetchDaemonImages());

  const actor = actorFromCaller(scope);
  if (current === null) {
    await scope.system.audit.append({
      ...actor,
      action: 'image_catalog_entry.created',
      description: `Image catalog entry '${id}' created in namespace '${namespace}' by ${wording.article} ${options.act}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        namespace,
        id,
        name: stored.name,
        source: stored.source,
        ...(stored.declaredSource !== undefined ? { declaredSource: stored.declaredSource } : {}),
      },
      outputSnapshot: { id },
      basis:
        options.act === 'upload'
          ? 'Image catalog entry created by an uploaded build context via API'
          : 'Image catalog entry created by a registry pull via API',
      entityType: 'imageCatalogEntry',
      entityId: id,
      namespace,
    });
  }
  await scope.system.audit.append({
    ...actor,
    ...options.versionAudit(image, id),
    timestamp: new Date().toISOString(),
    outputSnapshot: { imageTag: image, entryId: id },
    entityType: 'imageCatalogEntry',
    entityId: id,
    namespace,
  });

  if (changedDuring.length > 0) {
    throw new ConflictError(
      `"${image}" was ${wording.produced} and is a version of "${stored.name}", which another ${options.act} catalogued while this one ${wording.produced}: ${changedDuring.join(', ')} differ from that entry and were not applied. Edit the entry to change them.`,
    );
  }
  return { imageTag: image, entryId: id };
}

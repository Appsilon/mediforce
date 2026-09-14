import {
  checkBuildContextArchive,
  imageTagTakenMessage,
  ImageCatalogEntrySchema,
  type ImageCatalogEntry,
} from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import {
  ConflictError,
  HandlerError,
  PayloadTooLargeError,
  PreconditionFailedError,
  ValidationError,
} from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  UploadImageCatalogVersionInput,
  UploadImageCatalogVersionOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { buildUploadedImage, fetchDaemonImages } from '../system/_docker';
import { deriveImageCatalogEntryId } from './_source';
import { refreshEntryCapabilities } from './_capabilities';

/** `20260911-140437` — sortable, readable, and never a tag someone typed. */
function uploadTimeTag(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

/** The entry a reference's first upload creates, validated before the build. */
function firstUploadEntry(input: UploadImageCatalogVersionInput, id: string): ImageCatalogEntry {
  if (input.intent === undefined) {
    throw new ValidationError(
      `intent is required the first time "${input.reference}" is uploaded: one sentence saying what this image is for`,
    );
  }
  const parsed = ImageCatalogEntrySchema.safeParse({
    id,
    source: { kind: 'referenced', reference: input.reference },
    name: input.name ?? input.reference.split('/').pop(),
    intent: input.intent,
    declaredSource: input.declaredSource,
    capabilities: {},
  });
  if (parsed.success === false) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid input', parsed.error.issues);
  }
  return parsed.data;
}

/** The entry fields `input` would change. A later upload may repeat them but
 *  never change them: they belong to the entry, not to one version. */
function changedEntryFields(existing: ImageCatalogEntry, input: UploadImageCatalogVersionInput): string[] {
  const declaredKeys = ['repo', 'commit', 'dockerfile'] as const;
  return [
    input.name !== undefined && input.name !== existing.name ? 'name' : null,
    input.intent !== undefined && input.intent !== existing.intent ? 'intent' : null,
    input.declaredSource !== undefined &&
    declaredKeys.some((key) => input.declaredSource?.[key] !== existing.declaredSource?.[key])
      ? 'declaredSource'
      : null,
  ].filter((field) => field !== null);
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

  const id = deriveImageCatalogEntryId({ kind: 'referenced', reference });
  const existing = await scope.imageCatalog.getById(namespace, id);
  const changedBeforeBuild = existing === null ? [] : changedEntryFields(existing, input);
  if (existing !== null && changedBeforeBuild.length > 0) {
    throw new ValidationError(
      `"${reference}" is already catalogued as "${existing.name}", and an upload only adds a version to it: ${changedBeforeBuild.join(', ')} differ from the entry. Leave them out, or edit the entry.`,
    );
  }
  const entry = existing ?? firstUploadEntry(input, id);

  const tag = input.tag ?? uploadTimeTag(new Date());
  const image = `${reference}:${tag}`;

  // Checked here so a taken tag costs no build; the worker checks again just
  // before tagging, for an upload that took it meanwhile.
  const daemon = await fetchDaemonImages();
  if (daemon.available === false) {
    throw new PreconditionFailedError(
      'The Docker daemon could not be reached, so whether this tag is already taken cannot be checked.',
    );
  }
  if (daemon.images.some((row) => row.repository === reference && row.tag === tag)) {
    throw new ConflictError(imageTagTakenMessage(image));
  }

  try {
    await buildUploadedImage({ image, dockerfile, namespace }, context);
  } catch (error) {
    if (error instanceof HandlerError) throw error;
    throw new HandlerError(
      'internal',
      `Building "${image}" failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Re-read: another first upload may have created the entry while this one
  // built. Its fields stand, and any of this upload's that differ are refused
  // below, once the version they cannot change is audited.
  const current = await scope.imageCatalog.getById(namespace, id);
  const stored = current ?? (await scope.imageCatalog.upsert(namespace, entry));
  const changedDuringBuild = current === null ? [] : changedEntryFields(current, input);
  await refreshEntryCapabilities(namespace, stored, scope, await fetchDaemonImages());

  const actor = actorFromCaller(scope);
  if (current === null) {
    await scope.system.audit.append({
      ...actor,
      action: 'image_catalog_entry.created',
      description: `Image catalog entry '${id}' created in namespace '${namespace}' by an upload`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        namespace,
        id,
        name: stored.name,
        source: stored.source,
        ...(stored.declaredSource !== undefined ? { declaredSource: stored.declaredSource } : {}),
      },
      outputSnapshot: { id },
      basis: 'Image catalog entry created by an uploaded build context via API',
      entityType: 'imageCatalogEntry',
      entityId: id,
      namespace,
    });
  }
  await scope.system.audit.append({
    ...actor,
    action: 'image_catalog_entry.version_uploaded',
    description: `Image '${image}' built from an uploaded context for entry '${id}' in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, reference, tag, dockerfile, contextBytes: context.length },
    outputSnapshot: { imageTag: image, entryId: id },
    basis: 'Image built from an uploaded build context via API',
    entityType: 'imageCatalogEntry',
    entityId: id,
    namespace,
  });

  if (changedDuringBuild.length > 0) {
    throw new ConflictError(
      `"${image}" was built and is a version of "${stored.name}", which another upload catalogued while this one built: ${changedDuringBuild.join(', ')} differ from that entry and were not applied. Edit the entry to change them.`,
    );
  }
  return { imageTag: image, entryId: id };
}

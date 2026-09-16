import { resolveCarriedBuild } from '@mediforce/agent-runtime';
import {
  carriedContextFiles,
  packBuildContextArchive,
  type DockerBuildPaths,
  type WorkflowArtifact,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import { assertNamespaceAccess } from '../../auth';
import { NotFoundError, PreconditionFailedError, ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type {
  PublishImageCatalogVersionInput,
  PublishImageCatalogVersionOutput,
} from '../../contract/image-catalog';
import { actorFromCaller } from '../_helpers';
import { fetchDaemonImages } from '../system/_docker';
import { discoverEntries } from './_discovered';
import { resolveEntryVersions } from './_versions';
import { uploadImageCatalogVersion } from './upload-version';

/**
 * The workflow version and step build a carried image was built from: the one
 * whose files hash to the image's label. Newest first, so of two versions that
 * carry the same files the one an author last saw is named.
 */
function findCarriedBuild(
  definitions: readonly WorkflowDefinition[],
  dockerfile: string,
  contentHash: string,
): { definition: WorkflowDefinition; artifacts: WorkflowArtifact[]; paths: DockerBuildPaths } | null {
  const newestFirst = [...definitions].sort((a, b) => b.version - a.version);
  for (const definition of newestFirst) {
    for (const step of definition.steps) {
      for (const config of [step.agent, step.script]) {
        if (config === undefined) continue;
        const build = resolveCarriedBuild(config, definition);
        if (build === undefined || definition.artifacts === undefined) continue;
        if (build.paths.dockerfile === dockerfile && build.meta.artifactsHash === contentHash) {
          return { definition, artifacts: definition.artifacts, paths: build.paths };
        }
      }
    }
  }
  return null;
}

/**
 * Publish one version of a carried entry as a `referenced` image (ADR-0022).
 *
 * Rebuilt from the same files through the upload path rather than re-tagged: a
 * re-tag keeps the carried labels, so the published tag would also be a
 * version of the carried entry, and deleting that entry with its images would
 * take the published one too. The layers are cached, so the rebuild is quick.
 *
 * Going through `uploadImageCatalogVersion` means one publish audits as an
 * upload as well — `version_uploaded`, plus `image_catalog_entry.created` the
 * first time a reference is used. That is the honest record: what reached the
 * daemon is an upload, and only the row below says where its files came from.
 */
export async function publishImageCatalogVersion(
  input: PublishImageCatalogVersionInput,
  scope: CallerScope,
): Promise<PublishImageCatalogVersionOutput> {
  // Any workspace member, as for an upload: it is one.
  assertNamespaceAccess(scope.caller, input.namespace);
  const { namespace } = input;

  const daemon = await fetchDaemonImages();
  if (daemon.available === false) {
    throw new PreconditionFailedError(
      'The Docker daemon could not be reached, so the version to publish cannot be found.',
    );
  }
  const stored = await scope.imageCatalog.list(namespace);
  const entry =
    stored.find((candidate) => candidate.id === input.id) ??
    discoverEntries(namespace, daemon.images, stored).find((candidate) => candidate.id === input.id);
  if (entry === undefined) {
    throw new NotFoundError(`Image catalog entry '${input.id}' not found`);
  }
  if (entry.source.kind !== 'carried') {
    throw new ValidationError(
      `"${entry.name}" is not built from a workflow's carried files. Only those are published; an image from a repository or an upload already outlives any workflow.`,
    );
  }
  const { workflow, dockerfile } = entry.source;

  const version = resolveEntryVersions(namespace, entry.source, daemon.images).find(
    (candidate) => candidate.imageTag === input.imageTag,
  );
  if (version?.contentHash === undefined) {
    throw new NotFoundError(`"${input.imageTag}" is not a version of "${entry.name}" on the daemon.`);
  }

  const build = findCarriedBuild(
    await scope.workflowDefinitions.listVersions(namespace, workflow),
    dockerfile,
    version.contentHash,
  );
  if (build === null) {
    throw new PreconditionFailedError(
      `No version of workflow "${workflow}" still carries the files "${input.imageTag}" was built from, so there is nothing to publish from.`,
    );
  }

  const { paths } = build;
  // Reachable, not dead: a step may narrow the context to a directory the
  // Dockerfile sits outside of, which `docker build -f` allows and an uploaded
  // context does not. This handler calls the upload handler directly, so the
  // upload contract's own check never runs on it.
  const prefix = paths.context === '' ? '' : `${paths.context}/`;
  if (paths.dockerfile.startsWith(prefix) === false) {
    throw new ValidationError(
      `"${paths.dockerfile}" is outside its build context "${paths.context}", and a published image carries only its context.`,
    );
  }
  const encoder = new TextEncoder();
  const context = packBuildContextArchive(
    carriedContextFiles(build.artifacts, paths).map((file) => ({
      kind: 'file' as const,
      path: file.path,
      content: encoder.encode(file.contents),
      // As they are materialized for the /artifacts mount and the carried build.
      executable: true,
    })),
  );

  const published = await uploadImageCatalogVersion(
    {
      namespace,
      reference: input.reference,
      tag: input.tag,
      dockerfile: paths.dockerfile.slice(prefix.length),
      name: input.name,
      intent: input.intent,
      declaredSource: input.declaredSource,
      context,
    },
    scope,
  );

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'image_catalog_entry.version_published',
    description: `Image '${input.imageTag}' of entry '${entry.id}' published as '${published.imageTag}' in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace,
      id: entry.id,
      imageTag: input.imageTag,
      workflow,
      workflowVersion: build.definition.version,
      dockerfile,
    },
    outputSnapshot: published,
    basis: "Carried image published from its workflow's files via API",
    entityType: 'imageCatalogEntry',
    entityId: entry.id,
    namespace,
  });

  return published;
}

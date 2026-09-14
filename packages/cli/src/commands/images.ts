import { defineCommand } from '../define-command';
import { printJson } from '../output';
import { builtSourceLine, checkBuildContextArchive, formatBytes } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { packContextDirectory } from '../build-context';

/**
 * `mediforce images *` — the Image Catalog (ADR-0022): the images a workspace
 * offers for steps, one row per source, with a sentence saying what each is
 * for.
 *
 * Distinct from `mediforce system images`, which is the raw deployment-wide
 * daemon listing an admin uses to hunt disk. This one is curated, per-namespace
 * and author-facing; that one is unfiltered ops truth.
 */

const AVAILABILITY_NOTE: Record<ImageCatalogEntryView['availability'], string> = {
  present: '',
  absent: '  (no image on the daemon)',
  unknown: '  (daemon unreachable)',
};

/** Two spaces per level of lineage, so the shelf reads as the tree it is. */
function indentFor(entry: ImageCatalogEntryView, byId: Map<string, ImageCatalogEntryView>): string {
  let depth = 0;
  let current = entry.baseEntryId;
  const seen = new Set<string>([entry.id]);
  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = byId.get(current)?.baseEntryId ?? null;
  }
  return '  '.repeat(depth);
}

function describeSource(entry: ImageCatalogEntryView): string {
  return entry.source.kind === 'built'
    ? builtSourceLine(entry.source.repo, entry.source.dockerfile, entry.source.context)
    : entry.source.reference;
}

const CONTEXT_FLAG_DESCRIPTION =
  'Build context directory inside --repo, e.g. "." for the repo root. When set, --dockerfile is read from it; when absent, the context is the Dockerfile\'s own directory';

export const imagesListCommand = defineCommand({
  name: 'mediforce images list',
  description: 'List the Image Catalog entries a namespace offers for steps.',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.imageCatalog.list({ namespace: args.namespace });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.entries.length === 0) {
      output.stdout(`No image catalog entries in namespace "${args.namespace}".`);
      return 0;
    }
    output.stdout(`Image catalog for "${args.namespace}" (${String(result.entries.length)}):\n`);
    // The handler returns roots first with each derivative behind its base;
    // indenting is all that is left to make the grouping visible (#1296).
    const byId = new Map(result.entries.map((entry) => [entry.id, entry]));
    for (const entry of result.entries) {
      const indent = indentFor(entry, byId);
      output.stdout(`${indent}  ${entry.id}  ${entry.name}`);
      // A discovered entry has no sentence to print, so the line says what is
      // missing and how to supply it rather than printing a blank.
      output.stdout(
        entry.origin === 'discovered'
          ? `${indent}    (built here, not described yet — describe it with \`mediforce images create\`)`
          : `${indent}    ${entry.intent}`,
      );
      output.stdout(
        `${indent}    ${describeSource(entry)}  ·  ${String(entry.versions.length)} version(s)${AVAILABILITY_NOTE[entry.availability]}`,
      );
    }
    return 0;
  },
});

export const imagesShowCommand = defineCommand({
  name: 'mediforce images show',
  description: 'Show one Image Catalog entry and the versions currently on the daemon.',
  args: {
    entryId: {
      type: 'positional',
      required: true,
      description: 'Entry id (from `images list`)',
    },
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.imageCatalog.get({
      namespace: args.namespace,
      id: args.entryId,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    const { entry } = result;
    output.stdout(`${entry.name}  (${entry.id})`);
    output.stdout(
      entry.origin === 'discovered'
        ? '  Intent:  not described yet — this image was built here and nobody has said what it is for'
        : `  Intent:  ${entry.intent}`,
    );
    output.stdout(`  Source:  ${describeSource(entry)}  [${entry.source.kind}]`);
    if (entry.declaredSource !== undefined) {
      const declared = [
        entry.declaredSource.repo,
        entry.declaredSource.commit,
        entry.declaredSource.dockerfile,
      ]
        .filter((part) => part !== undefined)
        .join(' · ');
      output.stdout(`  Declared source (not derived):  ${declared}`);
    }
    if (entry.availability === 'unknown') {
      output.stdout('  Versions: unknown — the Docker daemon could not be reached.');
      return 0;
    }
    if (entry.versions.length === 0) {
      output.stdout('  Versions: none — no image for this source is on the daemon.');
      return 0;
    }
    output.stdout(`  Versions (${String(entry.versions.length)}):`);
    for (const version of entry.versions) {
      output.stdout(
        `    ${version.imageTag}  ${version.commit ?? '—'}  ${version.size}  ${version.created}`,
      );
      const { base, addedSteps } = version.lineage;
      output.stdout(`      Base:  ${base === null ? 'none (root)' : base.imageTag}`);
      if (addedSteps !== undefined && addedSteps.length > 0) {
        // Never "the Dockerfile": no file contents, no comments, no
        // multi-stage — the layers this image adds over its base, and nothing
        // more (#1296).
        output.stdout(
          `      Layer summary${base === null ? '' : ' over the base'} (${String(addedSteps.length)} steps):`,
        );
        for (const step of addedSteps) {
          output.stdout(`        ${step.size.padStart(8)}  ${step.command}`);
        }
      }
    }
    return 0;
  },
});

export const imagesCreateCommand = defineCommand({
  name: 'mediforce images create',
  description:
    'Catalogue an image. Either --repo (a source the platform builds) or --reference (a pushed image).',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    name: { type: 'string', required: true, description: 'Human handle, e.g. "TealFlow agent"' },
    intent: {
      type: 'string',
      required: true,
      description: 'One sentence: what this image is FOR (not what is inside it)',
    },
    repo: { type: 'string', description: 'Git repo the image is built from (built source)' },
    dockerfile: { type: 'string', description: 'Dockerfile path inside --repo' },
    context: { type: 'string', description: CONTEXT_FLAG_DESCRIPTION },
    reference: {
      type: 'string',
      description: 'Untagged image reference, e.g. mediforce-golden-image (referenced source)',
    },
    'declared-repo': { type: 'string', description: 'Declared source repo (not derived)' },
    'declared-commit': { type: 'string', description: 'Declared source commit (not derived)' },
    'declared-dockerfile': { type: 'string', description: 'Declared Dockerfile (not derived)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if ((args.repo === undefined) === (args.reference === undefined)) {
      output.stderr('Supply exactly one of --repo (built) or --reference (referenced).');
      return 2;
    }
    const source =
      args.repo !== undefined
        ? ({
            kind: 'built',
            repo: args.repo,
            dockerfile: args.dockerfile ?? '',
            context: args.context,
          } as const)
        : ({ kind: 'referenced', reference: args.reference as string } as const);

    const declaredSource = {
      ...(args['declared-repo'] !== undefined ? { repo: args['declared-repo'] } : {}),
      ...(args['declared-commit'] !== undefined ? { commit: args['declared-commit'] } : {}),
      ...(args['declared-dockerfile'] !== undefined
        ? { dockerfile: args['declared-dockerfile'] }
        : {}),
    };

    const result = await mediforce.imageCatalog.create({
      namespace: args.namespace,
      name: args.name,
      intent: args.intent,
      source,
      ...(Object.keys(declaredSource).length > 0 ? { declaredSource } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Catalogued "${result.entry.name}" as ${result.entry.id}.`);
    return 0;
  },
});

export const imagesUpdateCommand = defineCommand({
  name: 'mediforce images update',
  description:
    "Change an entry's name, intent or source. Changing the source re-keys the entry: the id derives from it, so the entry moves and prints its new id.",
  args: {
    entryId: {
      type: 'positional',
      required: true,
      description: 'Entry id (from `images list`)',
    },
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    name: { type: 'string', description: 'New human handle' },
    intent: { type: 'string', description: 'New one-sentence intent' },
    repo: {
      type: 'string',
      description:
        'New git repo (built source). Replaces the whole source, so pass --dockerfile and --context with it — either one left out resets to its default. Re-keys the entry when the Dockerfile it names changes',
    },
    dockerfile: {
      type: 'string',
      description: 'New Dockerfile path inside --repo. Empty means the default',
    },
    context: { type: 'string', description: CONTEXT_FLAG_DESCRIPTION },
    reference: { type: 'string', description: 'New untagged image reference (referenced source)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args.repo !== undefined && args.reference !== undefined) {
      output.stderr('Supply at most one of --repo (built) or --reference (referenced).');
      return 2;
    }
    // The source is a pair, and the entry is keyed on both halves, so a
    // Dockerfile with no repo cannot be resolved into a key without reading
    // the entry back first — which is a race the CLI has no reason to run.
    if (args.dockerfile !== undefined && args.repo === undefined) {
      output.stderr('--dockerfile changes the source, so pass --repo with it.');
      return 2;
    }
    if (args.context !== undefined && args.repo === undefined) {
      output.stderr('--context changes the source, so pass --repo with it.');
      return 2;
    }
    const source =
      args.repo !== undefined
        ? ({
            kind: 'built',
            repo: args.repo,
            dockerfile: args.dockerfile ?? '',
            context: args.context,
          } as const)
        : args.reference !== undefined
          ? ({ kind: 'referenced', reference: args.reference } as const)
          : undefined;

    if (args.name === undefined && args.intent === undefined && source === undefined) {
      output.stderr('Nothing to update: supply --name, --intent, --repo and/or --reference.');
      return 2;
    }
    const result = await mediforce.imageCatalog.update({
      namespace: args.namespace,
      id: args.entryId,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.intent !== undefined ? { intent: args.intent } : {}),
      ...(source !== undefined ? { source } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    // The id is the one thing a re-key changes that a caller cannot predict,
    // so say it moved rather than reporting a no-op success on the old id.
    output.stdout(
      result.entry.id === args.entryId
        ? `Updated ${result.entry.id}.`
        : `Updated ${args.entryId} — its source changed, so it is now ${result.entry.id}.`,
    );
    return 0;
  },
});

export const imagesDeleteCommand = defineCommand({
  name: 'mediforce images delete',
  description:
    "Delete an entry and the images behind it. Admin/owner only. Refused while a live workflow version still pins one of them — superseded and archived versions do not block.",
  args: {
    entryId: {
      type: 'positional',
      required: true,
      description: 'Entry id (from `images list`)',
    },
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    'keep-images': {
      type: 'boolean',
      description:
        'Remove only the catalog record, leaving the images on the daemon. Rarely what you want: anything this namespace built is re-derived on the next read as an undescribed entry',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const withImages = args['keep-images'] !== true;
    const result = await mediforce.imageCatalog.delete({
      namespace: args.namespace,
      id: args.entryId,
      ...(withImages ? { withImages: true } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted ${args.entryId} from "${args.namespace}".`);
    // Named, not counted: these are gone from the daemon deployment-wide, and
    // the tags are what a reader needs to know went.
    for (const tag of result.deletedImages) {
      output.stdout(`  Removed ${tag} from the daemon.`);
    }
    if (withImages && result.deletedImages.length === 0) {
      output.stdout('  No image for this entry was on the daemon.');
    }
    return 0;
  },
});

/** Flags that only mean something for an uploaded context. */
const UPLOAD_ONLY_FLAGS = ['tag', 'name', 'intent', 'declared-repo', 'declared-commit', 'declared-dockerfile'] as const;

export const imagesBuildCommand = defineCommand({
  name: 'mediforce images build',
  description:
    'Build one version of an image on the deployment, without running a workflow — from a git repo at a commit (--repo, --commit), or from a local directory uploaded as the build context (--reference, --context).',
  args: {
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    repo: { type: 'string', description: 'Git repo to build from' },
    commit: { type: 'string', description: 'Commit to check out and build (with --repo)' },
    dockerfile: {
      type: 'string',
      description: 'Dockerfile path inside --repo, or from the root of a local --context',
    },
    context: {
      type: 'string',
      description: `With --repo: ${CONTEXT_FLAG_DESCRIPTION}. With --reference: the local directory to upload as the build context — all of it but what its .dockerignore excludes, which is never uploaded`,
    },
    reference: {
      type: 'string',
      description:
        'Untagged image name to build a local --context under, starting with "<namespace>/". Catalogued as a referenced entry — the platform keeps no inputs, so it cannot rebuild it',
    },
    tag: {
      type: 'string',
      description: 'Tag for an uploaded build. Defaults to the upload time; a tag already on the daemon is refused',
    },
    name: { type: 'string', description: 'Entry name, set by the first upload of a --reference' },
    intent: {
      type: 'string',
      description: 'One sentence: what this image is FOR. Required by the first upload of a --reference',
    },
    'declared-repo': { type: 'string', description: 'Declared source repo, set by the first upload (not derived)' },
    'declared-commit': { type: 'string', description: 'Declared source commit, set by the first upload (not derived)' },
    'declared-dockerfile': { type: 'string', description: 'Declared Dockerfile, set by the first upload (not derived)' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if ((args.repo === undefined) === (args.reference === undefined)) {
      output.stderr(
        'Supply exactly one of --repo (a git repo at --commit) or --reference (a local --context uploaded as the build context).',
      );
      return 2;
    }

    if (args.reference !== undefined) {
      if (args.context === undefined) {
        output.stderr('--reference builds a local directory: pass it as --context.');
        return 2;
      }
      if (args.commit !== undefined) {
        output.stderr('--commit applies to --repo. An uploaded context has no commit — declare one with --declared-commit.');
        return 2;
      }
      // Checked here as well as by the platform, so a context that cannot build
      // fails before it is uploaded rather than after.
      const dockerfile = args.dockerfile ?? '';
      const { archive, ignoreFile } = await packContextDirectory(args.context, dockerfile);
      const check = checkBuildContextArchive(archive, dockerfile);
      if (check.ok === false) throw new Error(check.message);

      const declaredSource = {
        ...(args['declared-repo'] !== undefined ? { repo: args['declared-repo'] } : {}),
        ...(args['declared-commit'] !== undefined ? { commit: args['declared-commit'] } : {}),
        ...(args['declared-dockerfile'] !== undefined ? { dockerfile: args['declared-dockerfile'] } : {}),
      };
      if (jsonMode === false) {
        const ignored = ignoreFile === null ? '' : `, ${ignoreFile} applied`;
        output.stdout(
          `Uploading ${args.context} (${formatBytes(archive.length)}${ignored}) and building ${args.reference} — this takes a few minutes...`,
        );
      }
      const result = await mediforce.imageCatalog.upload({
        namespace: args.namespace,
        reference: args.reference,
        dockerfile,
        context: archive,
        ...(args.tag !== undefined ? { tag: args.tag } : {}),
        ...(args.name !== undefined ? { name: args.name } : {}),
        ...(args.intent !== undefined ? { intent: args.intent } : {}),
        ...(Object.keys(declaredSource).length > 0 ? { declaredSource } : {}),
      });
      if (jsonMode) {
        printJson(output, result);
        return 0;
      }
      output.stdout(`Built ${result.imageTag} for entry ${result.entryId}.`);
      output.stdout('It is offered in the catalog — `mediforce images list` to see it.');
      return 0;
    }

    const { repo, commit } = args;
    if (repo === undefined || commit === undefined) {
      output.stderr('--repo builds a commit: pass it as --commit.');
      return 2;
    }
    const uploadOnly = UPLOAD_ONLY_FLAGS.filter((flag) => args[flag] !== undefined);
    if (uploadOnly.length > 0) {
      output.stderr(
        `${uploadOnly.map((flag) => `--${flag}`).join(', ')} apply to an uploaded context (--reference), not to --repo.`,
      );
      return 2;
    }
    if (jsonMode === false) {
      // A clone plus a Dockerfile takes minutes and the command shows nothing
      // until it lands, so say so rather than looking hung.
      output.stdout(`Building ${repo}@${commit.slice(0, 8)} — this takes a few minutes...`);
    }
    const result = await mediforce.imageCatalog.build({
      namespace: args.namespace,
      repo,
      commit,
      dockerfile: args.dockerfile ?? '',
      context: args.context,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Built ${result.imageTag} for entry ${result.entryId}.`);
    output.stdout('It is offered in the catalog — `mediforce images list` to see it.');
    return 0;
  },
});

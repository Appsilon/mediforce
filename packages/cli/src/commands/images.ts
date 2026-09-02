import { defineCommand } from '../define-command';
import { printJson } from '../output';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';

/**
 * `mediforce images *` — the Image Catalog (ADR-0021): the images a workspace
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

function describeSource(entry: ImageCatalogEntryView): string {
  return entry.source.kind === 'built'
    ? `${entry.source.repo}${entry.source.dockerfile === '' ? '' : ` · ${entry.source.dockerfile}`}`
    : entry.source.reference;
}

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
    for (const entry of result.entries) {
      output.stdout(`  ${entry.id}  ${entry.name}`);
      output.stdout(`    ${entry.intent}`);
      output.stdout(
        `    ${describeSource(entry)}  ·  ${String(entry.versions.length)} version(s)${AVAILABILITY_NOTE[entry.availability]}`,
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
    output.stdout(`  Intent:  ${entry.intent}`);
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
        ? ({ kind: 'built', repo: args.repo, dockerfile: args.dockerfile ?? '' } as const)
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
    "Change an entry's name or intent. The source is the entry's key and cannot be edited.",
  args: {
    entryId: {
      type: 'positional',
      required: true,
      description: 'Entry id (from `images list`)',
    },
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
    name: { type: 'string', description: 'New human handle' },
    intent: { type: 'string', description: 'New one-sentence intent' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    if (args.name === undefined && args.intent === undefined) {
      output.stderr('Nothing to update: supply --name and/or --intent.');
      return 2;
    }
    const result = await mediforce.imageCatalog.update({
      namespace: args.namespace,
      id: args.entryId,
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.intent !== undefined ? { intent: args.intent } : {}),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Updated ${result.entry.id}.`);
    return 0;
  },
});

export const imagesDeleteCommand = defineCommand({
  name: 'mediforce images delete',
  description:
    'Remove an entry. Removes an offer, never a capability — no workflow points at an entry.',
  args: {
    entryId: {
      type: 'positional',
      required: true,
      description: 'Entry id (from `images list`)',
    },
    namespace: { type: 'string', required: true, description: 'Namespace handle' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.imageCatalog.delete({
      namespace: args.namespace,
      id: args.entryId,
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted ${args.entryId} from "${args.namespace}".`);
    return 0;
  },
});

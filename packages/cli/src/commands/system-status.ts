import type { DockerInfoResponse } from '@mediforce/platform-api/contract';
import { defineCommand } from '../define-command';
import { printJson, type OutputSink } from '../output';

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

function printImages(output: OutputSink, data: Extract<DockerInfoResponse, { available: true }>): void {
  output.stdout(`${padRight('REPOSITORY', 35)} ${padRight('TAG', 15)} ${padLeft('SIZE', 10)} ${padRight('CREATED', 15)}`);
  for (const img of data.images) {
    output.stdout(
      `${padRight(img.repository, 35)} ${padRight(img.tag, 15)} ${padLeft(img.size, 10)} ${padRight(img.created, 15)}`,
    );
  }
  output.stdout(`\n${String(data.images.length)} image(s)`);
}

function printDisk(output: OutputSink, data: Extract<DockerInfoResponse, { available: true }>): void {
  output.stdout(`${padRight('TYPE', 20)} ${padLeft('COUNT', 6)} ${padLeft('ACTIVE', 7)} ${padLeft('SIZE', 10)}`);
  const disk = data.disk;
  output.stdout(`${padRight('Images', 20)} ${padLeft(String(disk.images.totalCount), 6)} ${padLeft('—', 7)} ${padLeft(disk.images.size, 10)}`);
  output.stdout(`${padRight('Containers', 20)} ${padLeft(String(disk.containers.totalCount), 6)} ${padLeft(String(disk.containers.active), 7)} ${padLeft(disk.containers.size, 10)}`);
  output.stdout(`${padRight('Build Cache', 20)} ${padLeft('—', 6)} ${padLeft('—', 7)} ${padLeft(disk.buildCache.size, 10)}`);
}

export const systemStatusCommand = defineCommand({
  name: 'mediforce system status',
  description: 'Show Docker infrastructure status: images, disk usage, and connectivity.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const data = await mediforce.system.dockerInfo();
    if (jsonMode) {
      printJson(output, data);
      return 0;
    }
    if (data.available === false) {
      output.stdout('Docker: unavailable (container-worker not reachable)');
      return 0;
    }
    output.stdout('Docker: connected\n');
    printImages(output, data);
    output.stdout('');
    printDisk(output, data);
    return 0;
  },
});

export const systemImagesCommand = defineCommand({
  name: 'mediforce system images',
  description: 'List Docker images available on the platform.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const data = await mediforce.system.dockerInfo();
    if (data.available === false) {
      if (jsonMode) printJson(output, { images: [], available: false });
      else output.stdout('Docker unavailable — no images to show.');
      return 0;
    }
    if (jsonMode) {
      printJson(output, { images: data.images });
      return 0;
    }
    printImages(output, data);
    return 0;
  },
});

export const systemRmiCommand = defineCommand({
  name: 'mediforce system rmi',
  description: 'Remove a Docker image by ID or name:tag.',
  args: {
    imageId: {
      type: 'positional',
      required: true,
      description: 'Image ID or name:tag',
    },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const result = await mediforce.dockerImages.delete({ imageId: args.imageId });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    output.stdout(`Deleted: ${result.deleted}`);
    return 0;
  },
});

export const systemDiskCommand = defineCommand({
  name: 'mediforce system disk',
  description: 'Show Docker disk usage breakdown.',
  args: {},
  async run({ output, mediforce, jsonMode }) {
    const data = await mediforce.system.dockerInfo();
    if (data.available === false) {
      if (jsonMode) printJson(output, { disk: null, available: false });
      else output.stdout('Docker unavailable — no disk info to show.');
      return 0;
    }
    if (jsonMode) {
      printJson(output, { disk: data.disk });
      return 0;
    }
    printDisk(output, data);
    return 0;
  },
});

export const systemPruneImagesCommand = defineCommand({
  name: 'mediforce system prune-images',
  description:
    'Delete the mediforce-artifacts:* and mediforce-built:* images nothing needs any more: no workflow, agent or live run names them and they are older than --min-age-days. The runtime rebuilds either kind when a step needs it again. The cron heartbeat runs this daily; requires an API key.',
  args: {
    'dry-run': { type: 'boolean', description: 'List what would be deleted and delete nothing' },
    'min-age-days': { type: 'string', description: 'Minimum image age in days (default: 14)' },
    images: { type: 'string', description: 'Comma-separated repository:tag list to narrow the sweep to' },
  },
  async run({ args, output, mediforce, jsonMode }) {
    const images = args.images?.split(',').map((image) => image.trim()).filter((image) => image !== '');
    const result = await mediforce.dockerImages.prune({
      dryRun: args['dry-run'] === true,
      ...(args['min-age-days'] === undefined ? {} : { minAgeDays: Number(args['min-age-days']) }),
      ...(images === undefined ? {} : { images }),
    });
    if (jsonMode) {
      printJson(output, result);
      return 0;
    }
    if (result.available === false) {
      output.stdout('Docker unavailable — nothing pruned.');
      return 0;
    }
    const verb = result.dryRun ? 'Would delete' : 'Deleted';
    output.stdout(`${verb} ${String(result.pruned.length)} image(s):`);
    for (const row of result.pruned) output.stdout(`  ${padRight(row.image, 50)} ${padLeft(row.size, 10)}`);
    output.stdout(`\nKept ${String(result.kept.length)} image(s):`);
    for (const row of result.kept) output.stdout(`  ${padRight(row.image, 50)} ${row.reason}`);
    if (result.failed.length > 0) {
      output.stdout(`\nFailed to delete ${String(result.failed.length)} image(s):`);
      for (const row of result.failed) output.stdout(`  ${row.image}: ${row.error}`);
      return 1;
    }
    return 0;
  },
});

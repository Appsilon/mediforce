import { parseArgs } from 'node:util';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import type { DockerInfoResponse } from '@mediforce/platform-api/contract';
import { resolveConfig } from '../config.js';
import { printJson, printError, type OutputSink } from '../output.js';

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

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

function parseFlags(input: CommandInput): { flags: { 'base-url'?: string; json?: boolean; help?: boolean } } | { error: string } {
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    return { flags: parsed.values };
  } catch (err) {
    return { error: String(err) };
  }
}

function handleApiError(err: unknown, output: OutputSink, jsonMode: boolean): number {
  if (err instanceof ApiError) {
    printError(output, { error: err.message, status: err.status, body: err.body }, jsonMode);
  } else {
    printError(output, { error: err instanceof Error ? err.message : String(err) }, jsonMode);
  }
  return 1;
}

export async function systemStatusCommand(input: CommandInput): Promise<number> {
  const result = parseFlags(input);
  if ('error' in result) { input.output.stderr(`mediforce system status: ${result.error}`); return 2; }
  const { flags } = result;

  if (flags.help === true) {
    input.output.stdout('Usage: mediforce system status [--base-url <url>] [--json] [--help]\n\nShow Docker infrastructure status: images, disk usage, and connectivity.\n');
    return 0;
  }

  const jsonMode = flags.json === true;

  try {
    const config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
    const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const data = await mediforce.system.dockerInfo();

    if (jsonMode) { printJson(input.output, data); return 0; }

    if (data.available === false) {
      input.output.stdout('Docker: unavailable (container-worker not reachable)');
      return 0;
    }

    input.output.stdout('Docker: connected\n');
    printImages(input.output, data);
    input.output.stdout('');
    printDisk(input.output, data);
    return 0;
  } catch (err) {
    return handleApiError(err, input.output, jsonMode);
  }
}

export async function systemImagesCommand(input: CommandInput): Promise<number> {
  const result = parseFlags(input);
  if ('error' in result) { input.output.stderr(`mediforce system images: ${result.error}`); return 2; }
  const { flags } = result;

  if (flags.help === true) {
    input.output.stdout('Usage: mediforce system images [--base-url <url>] [--json] [--help]\n\nList Docker images available on the platform.\n');
    return 0;
  }

  const jsonMode = flags.json === true;

  try {
    const config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
    const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const data = await mediforce.system.dockerInfo();

    if (data.available === false) {
      if (jsonMode) { printJson(input.output, { images: [], available: false }); }
      else { input.output.stdout('Docker unavailable — no images to show.'); }
      return 0;
    }

    if (jsonMode) { printJson(input.output, { images: data.images }); return 0; }
    printImages(input.output, data);
    return 0;
  } catch (err) {
    return handleApiError(err, input.output, jsonMode);
  }
}

export async function systemRmiCommand(input: CommandInput): Promise<number> {
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: true });
    const flags = parsed.values;
    const positionals = parsed.positionals;

    if (flags.help === true) {
      input.output.stdout('Usage: mediforce system rmi <imageId> [--base-url <url>] [--json] [--help]\n\nRemove a Docker image by ID or name:tag.\n');
      return 0;
    }

    const imageId = positionals[0];
    if (!imageId) {
      input.output.stderr('mediforce system rmi: missing image ID');
      input.output.stderr('Usage: mediforce system rmi <imageId>');
      return 2;
    }

    const jsonMode = flags.json === true;
    const config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
    const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const result = await mediforce.system.removeImage(imageId);

    if (jsonMode) { printJson(input.output, result); return 0; }
    input.output.stdout(`Deleted: ${result.deleted}`);
    return 0;
  } catch (err) {
    const jsonMode = input.argv.includes('--json');
    if (err instanceof ApiError) {
      printError(input.output, { error: err.message, status: err.status, body: err.body }, jsonMode);
    } else {
      printError(input.output, { error: err instanceof Error ? err.message : String(err) }, jsonMode);
    }
    return 1;
  }
}

export async function systemDiskCommand(input: CommandInput): Promise<number> {
  const result = parseFlags(input);
  if ('error' in result) { input.output.stderr(`mediforce system disk: ${result.error}`); return 2; }
  const { flags } = result;

  if (flags.help === true) {
    input.output.stdout('Usage: mediforce system disk [--base-url <url>] [--json] [--help]\n\nShow Docker disk usage breakdown.\n');
    return 0;
  }

  const jsonMode = flags.json === true;

  try {
    const config = resolveConfig({ flagBaseUrl: flags['base-url'], env: input.env });
    const mediforce = new Mediforce({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    const data = await mediforce.system.dockerInfo();

    if (data.available === false) {
      if (jsonMode) { printJson(input.output, { disk: null, available: false }); }
      else { input.output.stdout('Docker unavailable — no disk info to show.'); }
      return 0;
    }

    if (jsonMode) { printJson(input.output, { disk: data.disk }); return 0; }
    printDisk(input.output, data);
    return 0;
  } catch (err) {
    return handleApiError(err, input.output, jsonMode);
  }
}

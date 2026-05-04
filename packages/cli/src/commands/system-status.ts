import { parseArgs } from 'node:util';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { printJson, printError, type OutputSink } from '../output.js';

const execFileAsync = promisify(execFile);

interface CommandInput {
  argv: string[];
  env: Record<string, string | undefined>;
  output: OutputSink;
}

const HELP = `Usage: mediforce system status [options]

Show Docker infrastructure status: images, disk usage, and daemon connectivity.

Optional flags:
  --json         Emit JSON instead of human-readable output
  --help, -h     Show this help text
`;

const OPTIONS = {
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

interface DockerImage {
  repository: string;
  tag: string;
  id: string;
  size: string;
  created: string;
}

interface DiskRow {
  type: string;
  totalCount: number;
  active: number;
  size: string;
}

async function isDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['info']);
    return true;
  } catch {
    return false;
  }
}

async function listImages(): Promise<DockerImage[]> {
  const { stdout } = await execFileAsync('docker', ['images', '--format', '{{json .}}']);
  const raw = stdout.trim();
  if (raw.length === 0) return [];
  return raw.split('\n').map((line) => {
    const parsed = JSON.parse(line);
    return {
      repository: parsed.Repository,
      tag: parsed.Tag,
      id: parsed.ID,
      size: parsed.Size,
      created: parsed.CreatedSince,
    };
  });
}

async function getDiskUsage(): Promise<DiskRow[]> {
  const { stdout } = await execFileAsync('docker', ['system', 'df', '--format', '{{json .}}']);
  return stdout.trim().split('\n').map((line) => {
    const parsed = JSON.parse(line);
    return {
      type: parsed.Type,
      totalCount: Number(parsed.TotalCount ?? 0),
      active: Number(parsed.Active ?? 0),
      size: parsed.Size ?? '0B',
    };
  });
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

export async function systemStatusCommand(input: CommandInput): Promise<number> {
  let flags: { json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce system status: ${String(err)}`);
    return 2;
  }

  if (flags.help === true) {
    input.output.stdout(HELP);
    return 0;
  }

  const jsonMode = flags.json === true;
  const dockerOk = await isDockerAvailable();

  if (!dockerOk) {
    if (jsonMode) {
      printJson(input.output, { available: false, error: 'Docker daemon not reachable' });
    } else {
      input.output.stderr('Docker daemon not reachable. Is Docker running?');
    }
    return 1;
  }

  try {
    const [images, disk] = await Promise.all([listImages(), getDiskUsage()]);

    if (jsonMode) {
      printJson(input.output, { available: true, images, disk });
      return 0;
    }

    input.output.stdout('Docker: connected\n');

    // Images table
    input.output.stdout(`${padRight('REPOSITORY', 35)} ${padRight('TAG', 15)} ${padRight('SIZE', 10)} ${padRight('CREATED', 15)}`);
    for (const img of images) {
      input.output.stdout(
        `${padRight(img.repository, 35)} ${padRight(img.tag, 15)} ${padLeft(img.size, 10)} ${padRight(img.created, 15)}`,
      );
    }
    input.output.stdout(`\n${String(images.length)} image(s)\n`);

    // Disk table
    input.output.stdout(`${padRight('TYPE', 20)} ${padLeft('COUNT', 6)} ${padLeft('ACTIVE', 7)} ${padLeft('SIZE', 10)}`);
    for (const row of disk) {
      input.output.stdout(
        `${padRight(row.type, 20)} ${padLeft(String(row.totalCount), 6)} ${padLeft(String(row.active), 7)} ${padLeft(row.size, 10)}`,
      );
    }

    return 0;
  } catch (err) {
    printError(input.output, { error: `Docker query failed: ${err instanceof Error ? err.message : String(err)}` }, jsonMode);
    return 1;
  }
}

export async function systemImagesCommand(input: CommandInput): Promise<number> {
  let flags: { json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce system images: ${String(err)}`);
    return 2;
  }

  if (flags.help === true) {
    input.output.stdout('Usage: mediforce system images [--json] [--help]\n\nList Docker images available on the host.\n');
    return 0;
  }

  const jsonMode = flags.json === true;

  try {
    const images = await listImages();

    if (jsonMode) {
      printJson(input.output, { images });
      return 0;
    }

    input.output.stdout(`${padRight('REPOSITORY', 35)} ${padRight('TAG', 15)} ${padRight('SIZE', 10)} ${padRight('CREATED', 15)}`);
    for (const img of images) {
      input.output.stdout(
        `${padRight(img.repository, 35)} ${padRight(img.tag, 15)} ${padLeft(img.size, 10)} ${padRight(img.created, 15)}`,
      );
    }
    input.output.stdout(`\n${String(images.length)} image(s)`);
    return 0;
  } catch (err) {
    printError(input.output, { error: `Failed to list images: ${err instanceof Error ? err.message : String(err)}` }, jsonMode);
    return 1;
  }
}

export async function systemDiskCommand(input: CommandInput): Promise<number> {
  let flags: { json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({ args: input.argv, options: OPTIONS, strict: true, allowPositionals: false });
    flags = parsed.values;
  } catch (err) {
    input.output.stderr(`mediforce system disk: ${String(err)}`);
    return 2;
  }

  if (flags.help === true) {
    input.output.stdout('Usage: mediforce system disk [--json] [--help]\n\nShow Docker disk usage breakdown.\n');
    return 0;
  }

  const jsonMode = flags.json === true;

  try {
    const disk = await getDiskUsage();

    if (jsonMode) {
      printJson(input.output, { disk });
      return 0;
    }

    input.output.stdout(`${padRight('TYPE', 20)} ${padLeft('COUNT', 6)} ${padLeft('ACTIVE', 7)} ${padLeft('SIZE', 10)}`);
    for (const row of disk) {
      input.output.stdout(
        `${padRight(row.type, 20)} ${padLeft(String(row.totalCount), 6)} ${padLeft(String(row.active), 7)} ${padLeft(row.size, 10)}`,
      );
    }
    return 0;
  } catch (err) {
    printError(input.output, { error: `Failed to get disk usage: ${err instanceof Error ? err.message : String(err)}` }, jsonMode);
    return 1;
  }
}

/**
 * An uploaded build context as one ustar/PAX tar archive, browser-safe
 * (#1345; why tar and why written here: docs/adr/0022-image-catalog.md).
 */

import { normalizeRepoPath, resolveDockerBuildPaths } from './docker-build-paths';
import { formatBytes } from './format';

/** Under Next's 110 MiB `proxyClientMaxBodySize`, which truncates a larger
 *  body before any handler can say why. */
export const BUILD_CONTEXT_MAX_BYTES = 100 * 1024 * 1024;

/** The media type an uploaded context travels under, on every hop. */
export const BUILD_CONTEXT_MEDIA_TYPE = 'application/x-tar';

export type BuildContextArchiveEntry =
  | { kind: 'file'; path: string; content: Uint8Array; executable?: boolean; modifiedMs?: number }
  | { kind: 'directory'; path: string; modifiedMs?: number }
  | { kind: 'symlink'; path: string; target: string; modifiedMs?: number };

/** One entry as an archive lists it. `other` is a device, pipe or anything a
 *  build context has no use for. */
export interface ArchivedEntry {
  path: string;
  kind: 'file' | 'directory' | 'symlink' | 'hardlink' | 'other';
  size: number;
  linkTarget: string;
}

const BLOCK = 512;
const NAME_LENGTH = 100;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const TYPEFLAG = { file: '0', hardlink: '1', symlink: '2', directory: '5', pax: 'x' } as const;

function writeString(block: Uint8Array, offset: number, length: number, value: string): void {
  block.set(encoder.encode(value).subarray(0, length), offset);
}

/** Zero-padded octal, NUL-terminated — the only number shape ustar has. */
function writeOctal(block: Uint8Array, offset: number, length: number, value: number): void {
  writeString(block, offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function header(
  path: string,
  fields: { typeflag: string; mode: number; size: number; modifiedMs: number; linkTarget?: string },
): Uint8Array {
  const block = new Uint8Array(BLOCK);
  writeString(block, 0, NAME_LENGTH, path);
  writeOctal(block, 100, 8, fields.mode);
  writeOctal(block, 108, 8, 0);
  writeOctal(block, 116, 8, 0);
  writeOctal(block, 124, 12, fields.size);
  writeOctal(block, 136, 12, Math.max(0, Math.floor(fields.modifiedMs / 1000)));
  writeString(block, 148, 8, ' '.repeat(8));
  writeString(block, 156, 1, fields.typeflag);
  writeString(block, 157, NAME_LENGTH, fields.linkTarget ?? '');
  writeString(block, 257, 6, 'ustar\0');
  writeString(block, 263, 2, '00');
  writeString(block, 148, 8, `${checksum(block).toString(8).padStart(6, '0')}\0 `);
  return block;
}

/** Sum of the header bytes with the checksum field read as spaces. */
function checksum(block: Uint8Array): number {
  let sum = 0;
  for (let index = 0; index < BLOCK; index += 1) {
    sum += index >= 148 && index < 156 ? 0x20 : (block[index] ?? 0);
  }
  return sum;
}

/** `<length> <key>=<value>\n`, where the length counts its own digits. */
function paxRecord(key: string, value: string): string {
  const body = encoder.encode(` ${key}=${value}\n`).length;
  let length = body;
  while (body + String(length).length !== length) length = body + String(length).length;
  return `${length} ${key}=${value}\n`;
}

function padded(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / BLOCK) * BLOCK);
  out.set(data);
  return out;
}

/** A path or link target that does not fit a ustar field travels as a PAX
 *  record ahead of the entry, which every POSIX `tar` reads in its place. */
function longNameBlocks(path: string, linkTarget: string): Uint8Array[] {
  const records = [
    encoder.encode(path).length > NAME_LENGTH ? paxRecord('path', path) : '',
    encoder.encode(linkTarget).length > NAME_LENGTH ? paxRecord('linkpath', linkTarget) : '',
  ].join('');
  if (records === '') return [];
  const data = encoder.encode(records);
  return [
    header('PaxHeader', { typeflag: TYPEFLAG.pax, mode: 0o644, size: data.length, modifiedMs: 0 }),
    padded(data),
  ];
}

/** A tar archive of `entries`, in order. Directories end in `/` as `tar`
 *  writes them; paths are relative to the context root. */
export function packBuildContextArchive(entries: readonly BuildContextArchiveEntry[]): Uint8Array<ArrayBuffer> {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const modifiedMs = entry.modifiedMs ?? 0;
    if (entry.kind === 'file') {
      blocks.push(...longNameBlocks(entry.path, ''));
      blocks.push(
        header(entry.path, {
          typeflag: TYPEFLAG.file,
          mode: entry.executable === true ? 0o755 : 0o644,
          size: entry.content.length,
          modifiedMs,
        }),
        padded(entry.content),
      );
    } else if (entry.kind === 'directory') {
      const path = entry.path.endsWith('/') ? entry.path : `${entry.path}/`;
      blocks.push(...longNameBlocks(path, ''));
      blocks.push(header(path, { typeflag: TYPEFLAG.directory, mode: 0o755, size: 0, modifiedMs }));
    } else {
      blocks.push(...longNameBlocks(entry.path, entry.target));
      blocks.push(
        header(entry.path, {
          typeflag: TYPEFLAG.symlink,
          mode: 0o777,
          size: 0,
          modifiedMs,
          linkTarget: entry.target,
        }),
      );
    }
  }
  // Two zero blocks end an archive.
  blocks.push(new Uint8Array(BLOCK * 2));

  const archive = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) {
    archive.set(block, offset);
    offset += block.length;
  }
  return archive;
}

function readString(block: Uint8Array, offset: number, length: number): string {
  const field = block.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return decoder.decode(end === -1 ? field : field.subarray(0, end));
}

function readOctal(block: Uint8Array, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  if (/^[0-7]*$/.test(text) === false) throw new Error('Not a tar archive: a numeric field is not octal.');
  return text === '' ? 0 : parseInt(text, 8);
}

function parsePaxRecords(data: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  for (const line of decoder.decode(data).split('\n')) {
    const match = /^\d+ ([^=]+)=(.*)$/.exec(line);
    const [, key, value] = match ?? [];
    if (key !== undefined && value !== undefined) records.set(key, value);
  }
  return records;
}

function entryKind(typeflag: string): ArchivedEntry['kind'] {
  // `\0` is the pre-POSIX spelling of a regular file, `7` a contiguous one.
  if (typeflag === '0' || typeflag === '\0' || typeflag === '7' || typeflag === '') return 'file';
  if (typeflag === '5') return 'directory';
  if (typeflag === '2') return 'symlink';
  if (typeflag === '1') return 'hardlink';
  return 'other';
}

/**
 * Every entry in an archive, with PAX and GNU long names already applied — the
 * paths `tar` would extract, not the truncated ones in the ustar fields.
 * Throws on anything that is not a well-formed archive.
 */
export function listBuildContextArchive(archive: Uint8Array): ArchivedEntry[] {
  const entries: ArchivedEntry[] = [];
  let pending: { path?: string; linkTarget?: string; size?: number } = {};
  let offset = 0;

  while (offset + BLOCK <= archive.length) {
    const block = archive.subarray(offset, offset + BLOCK);
    if (block.every((byte) => byte === 0)) return entries;
    if (readOctal(block, 148, 8) !== checksum(block)) {
      throw new Error('Not a tar archive: a header checksum does not match.');
    }

    const typeflag = readString(block, 156, 1);
    const size = pending.size ?? readOctal(block, 124, 12);
    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error('The tar archive is cut off mid-entry.');
    const data = archive.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (typeflag === 'x') {
      const records = parsePaxRecords(data);
      const paxSize = records.get('size');
      pending = {
        ...pending,
        ...(records.has('path') ? { path: records.get('path') } : {}),
        ...(records.has('linkpath') ? { linkTarget: records.get('linkpath') } : {}),
        ...(paxSize !== undefined ? { size: Number(paxSize) } : {}),
      };
      continue;
    }
    // A global PAX header sets defaults nothing here reads.
    if (typeflag === 'g') continue;
    // GNU long names: the entry's data is the name of the next entry.
    if (typeflag === 'L' || typeflag === 'K') {
      const name = readString(data, 0, data.length);
      pending = typeflag === 'L' ? { ...pending, path: name } : { ...pending, linkTarget: name };
      continue;
    }

    const isUstar = readString(block, 257, 5) === 'ustar';
    const prefix = isUstar ? readString(block, 345, 155) : '';
    const name = readString(block, 0, NAME_LENGTH);
    entries.push({
      path: pending.path ?? (prefix === '' ? name : `${prefix}/${name}`),
      kind: entryKind(typeflag),
      size,
      linkTarget: pending.linkTarget ?? readString(block, 157, NAME_LENGTH),
    });
    pending = {};
  }

  // Ran out of bytes without the end-of-archive blocks, which is what a
  // truncated upload looks like.
  throw new Error('The tar archive is cut off: it has no end-of-archive marker.');
}

export type BuildContextArchiveCheck =
  | { ok: true }
  | { ok: false; reason: 'too_large' | 'invalid'; message: string };

/** `sample-data/ (336.0 MB), README.md (4.0 KB)` — the heaviest entries at the
 *  context root, a directory counting everything under it. */
function largestTopLevel(files: Iterable<{ path: string; size: number }>, count: number): string {
  const totals = new Map<string, number>();
  for (const { path, size } of files) {
    const slash = path.indexOf('/');
    const name = slash === -1 ? path : `${path.slice(0, slash)}/`;
    totals.set(name, (totals.get(name) ?? 0) + size);
  }
  return [...totals]
    .sort(([, left], [, right]) => right - left)
    .slice(0, count)
    .map(([name, size]) => `${name} (${formatBytes(size)})`)
    .join(', ');
}

/**
 * Whether a context of `bytes` is within the limit — on its own so a client can
 * refuse a directory from its file sizes, before reading a byte of it. Given
 * the `files`, the refusal names the largest, which is usually the fix.
 */
export function checkBuildContextSize(
  bytes: number,
  files: Iterable<{ path: string; size: number }> = [],
): BuildContextArchiveCheck {
  if (bytes <= BUILD_CONTEXT_MAX_BYTES) return { ok: true };
  const largest = largestTopLevel(files, 3);
  return {
    ok: false,
    reason: 'too_large',
    message:
      `The build context is ${formatBytes(bytes)}, over the ${formatBytes(BUILD_CONTEXT_MAX_BYTES)} limit.` +
      (largest === '' ? '' : ` Largest: ${largest}.`) +
      ' Leave out what the build does not COPY with a .dockerignore — what it excludes is not uploaded.',
  };
}

/** The nearest ancestor of `path` that is one of `links`, if any. */
function symlinkAncestor(path: string, links: ReadonlySet<string>): string | null {
  const segments = path.split('/');
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = segments.slice(0, depth).join('/');
    if (links.has(ancestor)) return ancestor;
  }
  return null;
}

/**
 * Why `dockerfile` cannot be read from a context holding `paths` (normalised,
 * from its root), or null — read as a repo build reads it from a named context.
 */
export function buildContextDockerfileProblem(dockerfile: string, paths: Iterable<string>): string | null {
  let dockerfilePath: string;
  try {
    dockerfilePath = resolveDockerBuildPaths(dockerfile, '.').dockerfile;
  } catch {
    return `Dockerfile "${dockerfile}" is outside the build context.`;
  }
  for (const path of paths) {
    if (path === dockerfilePath) return null;
  }
  return `No Dockerfile at "${dockerfilePath}" in the build context.`;
}

/** `path` from the context root, or null when it is absolute or climbs out. */
function contextPath(path: string): string | null {
  return path.startsWith('/') ? null : normalizeRepoPath(path);
}

/**
 * Whether `archive` can be handed to `docker build` as the context for
 * `dockerfile`. Run by the CLI and the Images view before uploading and by the
 * platform before the build host sees a byte (ADR-0022).
 */
export function checkBuildContextArchive(
  archive: Uint8Array,
  dockerfile: string,
): BuildContextArchiveCheck {
  const size = checkBuildContextSize(archive.length);
  if (size.ok === false) return size;

  const invalid = (message: string): BuildContextArchiveCheck => ({ ok: false, reason: 'invalid', message });

  let entries: ArchivedEntry[];
  try {
    entries = listBuildContextArchive(archive);
  } catch (error) {
    return invalid(`The build context is not a readable tar archive. ${error instanceof Error ? error.message : ''}`.trim());
  }

  const normalized: Array<{ entry: ArchivedEntry; path: string }> = [];
  for (const entry of entries) {
    const path = contextPath(entry.path);
    if (path === null) return invalid(`"${entry.path}" is outside the build context.`);
    if (entry.kind === 'other') {
      return invalid(`"${entry.path}" is not a file, directory or symlink, which is all a build context holds.`);
    }
    if (entry.kind === 'hardlink' && contextPath(entry.linkTarget) === null) {
      return invalid(`"${entry.path}" is a hard link to "${entry.linkTarget}", outside the build context.`);
    }
    normalized.push({ entry, path });
  }

  const links = new Set(normalized.filter(({ entry }) => entry.kind === 'symlink').map(({ path }) => path));
  for (const { entry, path } of normalized) {
    const link = symlinkAncestor(path, links);
    if (link !== null) {
      return invalid(`"${entry.path}" sits under the symlink "${link}", which could point anywhere.`);
    }
  }

  const dockerfileProblem = buildContextDockerfileProblem(
    dockerfile,
    normalized.filter(({ entry }) => entry.kind === 'file' || entry.kind === 'symlink').map(({ path }) => path),
  );
  return dockerfileProblem === null ? { ok: true } : invalid(dockerfileProblem);
}

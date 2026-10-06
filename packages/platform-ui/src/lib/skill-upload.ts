import { SKILL_MANIFEST_PATH, type SkillFile } from '@mediforce/platform-core';
import { decodeTextFile } from './workflow-file-uploads';

/** One file of an upload, as picked, dropped or unpacked from a zip. */
export interface UploadedEntry {
  path: string;
  bytes: Uint8Array;
}

const END_OF_DIRECTORY = 0x06054b50;
const CENTRAL_HEADER = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/** What a zip may unpack to. Well above the 256 KB a Skill stores, so a skill
 *  zipped with images or other binaries still unpacks and lists them as
 *  skipped, but bounded, so a zip bomb is refused before it fills the tab. */
export const UNZIP_MAX_BYTES = 16 * 1024 * 1024;

const TOO_LARGE = `This zip unpacks to more than ${String(UNZIP_MAX_BYTES / 1024 / 1024)} MB; a skill is far smaller than that.`;

/** Inflate one entry, stopping as soon as it outgrows the size its header
 *  declared: the declared sizes are what the archive is checked against, and
 *  a forged one must not let more through. */
async function inflateRaw(data: Uint8Array, declaredSize: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  // Not awaited: the write resolves only once the readable side is drained.
  void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done === true) break;
    total += value.length;
    if (total > declaredSize) {
      await reader.cancel();
      throw new Error(TOO_LARGE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

/**
 * Unpack a `.zip` in the browser, so the server never handles archives. The
 * browser's own `DecompressionStream` inflates; this reads only the zip
 * container around it. A Skill is at most 256 KB of text, so stored and
 * deflated entries are all it needs: Zip64, encryption and other compression
 * methods are refused by name. Every entry is checked, and the sizes the
 * archive declares are added up against {@link UNZIP_MAX_BYTES}, before
 * anything is inflated. Hidden entries are left out unread.
 */
export async function unzip(archive: Uint8Array): Promise<UploadedEntry[]> {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  // The end record sits in the last 22 bytes plus a comment of up to 64 KB.
  let end = -1;
  for (let at = archive.length - 22; at >= Math.max(0, archive.length - 22 - 0xffff); at -= 1) {
    if (view.getUint32(at, true) === END_OF_DIRECTORY) {
      end = at;
      break;
    }
  }
  if (end === -1) throw new Error('This file is not a zip archive.');

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names = new TextDecoder('utf-8');
  const planned: Array<{ path: string; method: number; compressedSize: number; size: number; localOffset: number }> = [];
  let declaredTotal = 0;
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== CENTRAL_HEADER) throw new Error('This zip archive is damaged.');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const path = names.decode(archive.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith('/') || isHidden(path)) continue;
    if ((flags & 1) === 1) throw new Error(`${path} is encrypted; upload an unencrypted zip.`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('Zip64 archives are not supported; a skill is far smaller than that.');
    }
    if (method !== STORED && method !== DEFLATED) {
      throw new Error(`${path} uses zip compression method ${String(method)}; only stored and deflated entries are supported.`);
    }
    declaredTotal += size;
    if (declaredTotal > UNZIP_MAX_BYTES) throw new Error(TOO_LARGE);
    planned.push({ path, method, compressedSize, size, localOffset });
  }

  const entries: UploadedEntry[] = [];
  for (const { path, method, compressedSize, size, localOffset } of planned) {
    if (view.getUint32(localOffset, true) !== LOCAL_HEADER) throw new Error('This zip archive is damaged.');
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    const data = archive.subarray(dataStart, dataStart + compressedSize);
    entries.push({ path, bytes: method === STORED ? data : await inflateRaw(data, size) });
  }
  return entries;
}

/** Hidden entries (`.git`, `.DS_Store`) are not part of a skill; the CLI's
 *  `--from <dir>` skips them too. `__MACOSX` is the metadata folder macOS adds
 *  to a zip, so only a zip has it. */
function isHidden(path: string): boolean {
  return path.split('/').some((segment) => segment.startsWith('.') || segment === '__MACOSX');
}

/** The order a Skill's files are shown in: SKILL.md first, then by path. */
export function compareSkillPaths(left: string, right: string): number {
  if (left === SKILL_MANIFEST_PATH) return -1;
  if (right === SKILL_MANIFEST_PATH) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Turn an uploaded folder or zip into the `files[]` a Skill takes. A skill
 * wrapped in one top-level folder (`my-skill/SKILL.md`, which is what a folder
 * picker and `zip -r` both produce) has that folder stripped, so a folder that
 * works as `skills/<name>/` in Claude Code uploads with no edits. Files that
 * are not text are returned by name in `skipped` rather than stored mangled.
 */
export function skillFilesFromUpload(entries: ReadonlyArray<UploadedEntry>): { files: SkillFile[]; skipped: string[] } {
  const visible = entries
    .map((entry) => ({ ...entry, path: entry.path.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter((entry) => isHidden(entry.path) === false);

  const firstSegments = new Set(visible.map((entry) => entry.path.split('/')[0]));
  const wrapped = visible.length > 0
    && firstSegments.size === 1
    && visible.every((entry) => entry.path.includes('/'));
  const strip = (path: string): string => (wrapped ? path.slice(path.indexOf('/') + 1) : path);

  const files: SkillFile[] = [];
  const skipped: string[] = [];
  for (const entry of visible) {
    const path = strip(entry.path);
    const contents = decodeTextFile(entry.bytes);
    if (contents === null) skipped.push(path);
    else files.push({ path, contents });
  }
  return { files: files.sort((left, right) => compareSkillPaths(left.path, right.path)), skipped };
}

/** Read picked files: a folder picker keeps each file's place in the folder
 *  in `webkitRelativePath`, which is empty for a single picked file. */
export async function entriesFromFiles(files: ReadonlyArray<File>): Promise<UploadedEntry[]> {
  return Promise.all(files.map(async (file) => ({
    path: file.webkitRelativePath !== '' ? file.webkitRelativePath : file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })));
}

/** A dropped folder arrives as directory entries, not files, so it is walked.
 *  The entries have to be taken while the drop event is live, so this reads
 *  them synchronously before its first await. */
export async function entriesFromDrop(items: DataTransferItemList): Promise<UploadedEntry[]> {
  const roots = Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null);
  const entries: UploadedEntry[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      entries.push({ path: entry.fullPath.replace(/^\/+/, ''), bytes: new Uint8Array(await file.arrayBuffer()) });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns the children in batches, then an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
      if (batch.length === 0) return;
      for (const child of batch) await walk(child);
    }
  };
  for (const root of roots) await walk(root);
  return entries;
}

/** A single `.zip` is unpacked; anything else is the files of a folder. */
export async function readSkillUpload(entries: ReadonlyArray<UploadedEntry>): Promise<{ files: SkillFile[]; skipped: string[] }> {
  const only = entries.length === 1 ? entries[0] : undefined;
  if (only !== undefined && only.path.toLowerCase().endsWith('.zip')) {
    return skillFilesFromUpload(await unzip(only.bytes));
  }
  return skillFilesFromUpload(entries);
}

/** What replacing `current` with `next` would add, change and remove. */
export function diffSkillFiles(
  current: ReadonlyArray<SkillFile>,
  next: ReadonlyArray<SkillFile>,
): { added: string[]; changed: string[]; removed: string[] } {
  const before = new Map(current.map((file) => [file.path, file.contents]));
  const after = new Set(next.map((file) => file.path));
  return {
    added: next.filter((file) => before.has(file.path) === false).map((file) => file.path),
    changed: next.filter((file) => before.has(file.path) && before.get(file.path) !== file.contents).map((file) => file.path),
    removed: current.filter((file) => after.has(file.path) === false).map((file) => file.path),
  };
}

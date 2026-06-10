/**
 * File transport for the BullMQ queue. BullMQ serializes job data and results
 * as JSON, so file contents cross Redis as base64 strings — raw Buffers would
 * be mangled into `{type:'Buffer',data:[...]}` blobs and utf-8 strings corrupt
 * binary files (PDF, XLSX, PNG, ZIP).
 *
 * Payload keys are POSIX relative paths inside the directory (nested allowed,
 * e.g. `charts/q1/plot.png`), so directory structure survives the queue the
 * same way it does on the local spawn path.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** POSIX relative path → base64-encoded file content. */
export type FilePayload = Record<string, string>;

/** Recursively read every file under `dir` into a JSON-safe payload.
 *  Throws when `dir` does not exist; unreadable individual files are skipped. */
export async function encodeFilePayload(dir: string): Promise<FilePayload> {
  const payload: FilePayload = {};
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = join(entry.parentPath, entry.name);
    const key = relative(dir, absolutePath).split(sep).join('/');
    try {
      payload[key] = (await readFile(absolutePath)).toString('base64');
    } catch (err) {
      console.warn(`[file-payload] Skipping unreadable file '${key}': ${err instanceof Error ? err.message : err}`);
    }
  }
  return payload;
}

/** Write a payload into `dir`, creating it and any nested directories. */
export async function decodeFilePayload(payload: FilePayload, dir: string): Promise<void> {
  const root = resolve(dir);
  await mkdir(root, { recursive: true });
  for (const [relativePath, base64Content] of Object.entries(payload)) {
    const absolutePath = resolve(root, relativePath);
    if (!absolutePath.startsWith(root + sep)) {
      throw new Error(`File payload key '${relativePath}' escapes target directory '${dir}'`);
    }
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, Buffer.from(base64Content, 'base64'));
  }
}

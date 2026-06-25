import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Readable } from 'node:stream';
import type { BlobStore } from '@mediforce/platform-core';

/**
 * Filesystem-backed `BlobStore` for task-attachment content (ADR-0003). Writes
 * under the `~/.mediforce` data volume — the same `MEDIFORCE_DATA_DIR` root the
 * agent-runtime workspace layout uses — in an `attachments/` subtree.
 *
 * Keys are sharded by their first two characters (`<root>/<ab>/<key>`) to keep
 * any single directory from growing unbounded. Reads stream the file via
 * `createReadStream` so large blobs never get buffered whole in memory.
 */
export class FilesystemBlobStore implements BlobStore {
  private readonly root: string;

  constructor(root?: string) {
    this.root = root ?? join(defaultDataDir(), 'attachments');
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async getStream(key: string): Promise<Readable | null> {
    const path = this.pathFor(key);
    try {
      await stat(path);
    } catch (error) {
      if (isErrnoException(error) && error.code === 'ENOENT') return null;
      throw error;
    }
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private pathFor(key: string): string {
    const shard = key.slice(0, 2);
    return join(this.root, shard, key);
  }
}

function defaultDataDir(): string {
  return process.env.MEDIFORCE_DATA_DIR ?? join(homedir(), '.mediforce');
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

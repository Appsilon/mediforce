import { Readable } from 'node:stream';
import type { BlobStore } from '../interfaces/blob-store';

/**
 * In-memory `BlobStore` for tests. Backed by a `Map<string, Buffer>`; reads
 * return a `Readable` over the stored buffer. No filesystem, no network.
 */
export class InMemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<string, Buffer>();

  async put(key: string, content: Buffer): Promise<void> {
    this.blobs.set(key, Buffer.from(content));
  }

  async getStream(key: string): Promise<Readable | null> {
    const content = this.blobs.get(key);
    if (content === undefined) return null;
    return Readable.from(content);
  }

  async delete(key: string): Promise<void> {
    this.blobs.delete(key);
  }

  /** Test helper: raw bytes for `key`, or `undefined` when missing. */
  getBytes(key: string): Buffer | undefined {
    return this.blobs.get(key);
  }

  /** Test helper: number of stored blobs. */
  get size(): number {
    return this.blobs.size;
  }
}

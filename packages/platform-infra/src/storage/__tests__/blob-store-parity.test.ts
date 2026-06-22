import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { InMemoryBlobStore } from '@mediforce/platform-core/testing';
import type { BlobStore } from '@mediforce/platform-core';
import { FilesystemBlobStore } from '../filesystem-blob-store';

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Shared contract for `BlobStore` (ADR-0003). Both the in-memory double and the
 * filesystem backend MUST satisfy it. `factory` returns the store under test.
 */
function contract(name: string, factory: () => BlobStore) {
  describe(`${name} — BlobStore contract`, () => {
    let store: BlobStore;

    beforeEach(() => {
      store = factory();
    });

    it('put then getStream round-trips bytes identically', async () => {
      const content = Buffer.from('adverse-event-grade-5\n', 'utf-8');
      await store.put('ab-key-1', content);

      const stream = await store.getStream('ab-key-1');
      expect(stream).not.toBeNull();
      const readBack = await collect(stream!);
      expect(readBack.equals(content)).toBe(true);
    });

    it('getStream returns null for a missing key', async () => {
      const stream = await store.getStream('cd-missing');
      expect(stream).toBeNull();
    });

    it('delete removes the blob; subsequent getStream is null', async () => {
      await store.put('ef-key-2', Buffer.from('payload'));
      await store.delete('ef-key-2');
      const stream = await store.getStream('ef-key-2');
      expect(stream).toBeNull();
    });

    it('delete on a missing key does not throw', async () => {
      await expect(store.delete('gh-missing')).resolves.toBeUndefined();
    });
  });
}

contract('InMemoryBlobStore', () => new InMemoryBlobStore());

describe('FilesystemBlobStore', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'blob-store-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  contract('FilesystemBlobStore', () => new FilesystemBlobStore(root));

  it('getStream streams large blobs without buffering them whole', async () => {
    const store = new FilesystemBlobStore(root);
    const sixtyMiB = 60 * 1024 * 1024;
    const content = Buffer.alloc(sixtyMiB, 0x41);
    await store.put('ij-large', content);

    const stream = await store.getStream('ij-large');
    expect(stream).not.toBeNull();
    // A `fs.ReadStream` proves the impl used `createReadStream` rather than
    // reading the whole file into a buffer.
    expect(stream).toBeInstanceOf(ReadStream);

    let total = 0;
    let chunkCount = 0;
    for await (const chunk of stream!) {
      total += chunk.length;
      chunkCount += 1;
    }
    expect(total).toBe(sixtyMiB);
    // Streaming yields many chunks rather than one giant buffer.
    expect(chunkCount).toBeGreaterThan(1);
  });
});

import type { Readable } from 'node:stream';

/**
 * Byte storage for task-attachment content (ADR-0003). Keyed by an opaque
 * string; the metadata (`task_attachments` row) owns name / content-type /
 * size. The store is unscoped — authorization happens at the metadata layer
 * (you can only learn a `blobKey` by reading a workspace-gated attachment row).
 *
 * The default implementation writes to the `~/.mediforce` data volume; an
 * S3-compatible implementation is a non-breaking future add (not built here).
 */
export interface BlobStore {
  /** Write `content` under `key`, overwriting any existing blob. */
  put(key: string, content: Buffer): Promise<void>;
  /** Open a read stream for `key`, or `null` when the key is missing. */
  getStream(key: string): Promise<Readable | null>;
  /** Remove the blob for `key`. No-op when the key is missing. */
  delete(key: string): Promise<void>;
}

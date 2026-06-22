import { ATTACHMENT_MAX_BYTES } from '@mediforce/platform-core';

/**
 * Maximum attachment size in bytes (ADR-0003 §4). Defaults to the 100 MiB hard
 * ceiling mirrored by the Postgres `attachment_size_guard` CHECK.
 */
export const DEFAULT_ATTACHMENT_MAX_BYTES = ATTACHMENT_MAX_BYTES;

/**
 * Resolves the effective attachment size limit. `MEDIFORCE_ATTACHMENT_MAX_BYTES`
 * may only LOWER the hard 100 MiB ceiling — a value above it is clamped down so
 * an upload can never pass this check then fail the DB CHECK as an unmapped 500.
 */
export function attachmentMaxBytes(): number {
  const raw = process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_ATTACHMENT_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `MEDIFORCE_ATTACHMENT_MAX_BYTES must be a positive integer, got "${raw}".`,
    );
  }
  return Math.min(parsed, ATTACHMENT_MAX_BYTES);
}

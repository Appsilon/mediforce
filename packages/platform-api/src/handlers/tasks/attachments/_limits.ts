/**
 * Maximum attachment size in bytes (ADR-0003 §4). Its own knob, default
 * 100 MiB — an operational disk guard, not a design cap. Mirrored as a
 * Postgres CHECK constraint (`attachment_size_guard`).
 */
export const DEFAULT_ATTACHMENT_MAX_BYTES = 104_857_600;

export function attachmentMaxBytes(): number {
  const raw = process.env.MEDIFORCE_ATTACHMENT_MAX_BYTES;
  if (raw === undefined || raw === '') return DEFAULT_ATTACHMENT_MAX_BYTES;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `MEDIFORCE_ATTACHMENT_MAX_BYTES must be a positive integer, got "${raw}".`,
    );
  }
  return parsed;
}

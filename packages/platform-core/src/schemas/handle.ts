import { z } from 'zod';

/**
 * Workspace / user handle constraints.
 *
 * Enforced at the user-input boundary (`POST /api/namespaces`, invite flows) so
 * new handles match Firestore document-id rules + URL safety. Existing
 * `NamespaceSchema.handle` stays open (`z.string().min(1)`) to avoid read-path
 * 400 loops on legacy docs — see `headless-migration-phase-4-plan.md` §9.
 */
export const HANDLE_MAX_LENGTH = 64;
export const HANDLE_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export const HandleSchema = z
  .string()
  .min(1)
  .max(HANDLE_MAX_LENGTH)
  .regex(
    HANDLE_REGEX,
    'handle must be lowercase alphanumeric with internal hyphens (no leading/trailing hyphen)',
  );

export type Handle = z.infer<typeof HandleSchema>;

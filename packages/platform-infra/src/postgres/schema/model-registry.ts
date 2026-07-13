import { pgTable, text, integer, boolean, jsonb, timestamp } from 'drizzle-orm/pg-core';

/**
 * Catalog of LLM models exposed via OpenRouter (PLAN-0001 §1.2).
 * Original Firestore path: modelRegistry/{encodedId}.
 *
 * Deployment-global (no `workspace` column / no FK to `workspaces`): a
 * background sync job mirrors OpenRouter into this table, and every
 * workspace reads from the same row set.
 *
 * The `_meta` document (`rankingsUpdatedAt`) is stored as a separate
 * single-row table to keep the entry rows pure (Firestore parity is the
 * collection-with-special-doc pattern; Postgres prefers a dedicated table).
 */
export const modelRegistryEntries = pgTable('model_registry_entries', {
  id: text('id').primaryKey(),
  canonicalSlug: text('canonical_slug'),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  contextLength: integer('context_length').notNull(),
  maxCompletionTokens: integer('max_completion_tokens'),
  pricing: jsonb('pricing').$type<{ input: number; output: number; cacheRead?: number }>().notNull(),
  modality: text('modality').notNull(),
  inputModalities: jsonb('input_modalities').$type<string[]>().notNull(),
  outputModalities: jsonb('output_modalities').$type<string[]>().notNull(),
  supportsTools: boolean('supports_tools').notNull(),
  supportsVision: boolean('supports_vision').notNull(),
  source: text('source').notNull(),
  requestCount: integer('request_count'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
});

/**
 * Single-row table mirroring the Firestore `_meta` document.
 * `id` is constrained to `'singleton'` via the primary key — there is
 * only ever one row.
 */
export const modelRegistryMeta = pgTable('model_registry_meta', {
  id: text('id').primaryKey().notNull(),
  rankingsUpdatedAt: timestamp('rankings_updated_at', { withTimezone: true }),
});

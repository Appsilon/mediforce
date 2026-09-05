import type { ImageCapabilityCache } from '@mediforce/platform-core';
import { pgTable, text, jsonb, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { workspaces } from './workspace';

/**
 * The images a workspace offers for steps (ADR-0021). Composite PK
 * `(workspace, id)` mirrors `tool_catalog_entries`, and `id` is derived
 * deterministically from `source` — which is what makes "one entry per
 * source" a property of the primary key rather than a handler convention.
 *
 * `source` is jsonb rather than four columns because it is a discriminated
 * union: a built source carries `repo` + `dockerfile`, a referenced one
 * carries `reference`, and flattening both into one row would make three of
 * the four columns meaningless on every row. The union is parsed on every
 * read and every write, for the reason the tool-catalog repository gives.
 *
 * There is no `versions` column, and that absence is load-bearing. Versions
 * are the daemon rows whose build labels match the source, recomputed on
 * read; storing them would make the catalog a second, drifting source of
 * truth about what images exist — the exact failure ADR-0021 decision 2
 * refuses. `intent` is the only field a human writes.
 */
export const imageCatalogEntries = pgTable(
  'image_catalog_entries',
  {
    workspace: text('workspace')
      .notNull()
      .references(() => workspaces.handle, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    name: text('name').notNull(),
    /** The one required human sentence: what this image is *for*. */
    intent: text('intent').notNull(),
    /** `ImageCatalogSourceSchema` — `{ kind: 'built' | 'referenced', ... }`. */
    source: jsonb('source').notNull(),
    /** `ImageCatalogDeclaredSourceSchema`. Declared, not derived. */
    declaredSource: jsonb('declared_source'),
    /** Derived runtime probes keyed by immutable daemon image ID. */
    capabilities: jsonb('capabilities').$type<ImageCapabilityCache>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.workspace, table.id] }),
  }),
);

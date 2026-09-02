import { and, eq } from 'drizzle-orm';
import {
  ImageCatalogEntrySchema,
  parseRow,
  type ImageCatalogEntry,
  type ImageCatalogRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { imageCatalogEntries } from '../schema/image-catalog';

/**
 * Postgres-backed ImageCatalogRepository (ADR-0021).
 *
 * Validation matches the tool-catalog backend: parse on every read AND every
 * write. `source` is a discriminated union in a `jsonb` column, which the
 * database cannot shape-check, so trusting it on read would accept whatever a
 * raw SQL fix or a schema-drifting migration left behind.
 */
export class PostgresImageCatalogRepository implements ImageCatalogRepository {
  constructor(private readonly db: Database) {}

  async getById(namespace: string, entryId: string): Promise<ImageCatalogEntry | null> {
    const rows = await this.db
      .select()
      .from(imageCatalogEntries)
      .where(
        and(
          eq(imageCatalogEntries.workspace, namespace),
          eq(imageCatalogEntries.id, entryId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toEntry(row) : null;
  }

  async list(namespace: string): Promise<ImageCatalogEntry[]> {
    const rows = await this.db
      .select()
      .from(imageCatalogEntries)
      .where(eq(imageCatalogEntries.workspace, namespace));
    return rows.map((r) => toEntry(r));
  }

  async upsert(namespace: string, entry: ImageCatalogEntry): Promise<ImageCatalogEntry> {
    const parsed = ImageCatalogEntrySchema.parse(entry);
    const values = {
      workspace: namespace,
      id: parsed.id,
      name: parsed.name,
      intent: parsed.intent,
      source: parsed.source,
      declaredSource: parsed.declaredSource ?? null,
      // updated_at is set by the set_updated_at() trigger on every UPDATE;
      // for INSERTs the column default `now()` fires.
    };
    await this.db
      .insert(imageCatalogEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [imageCatalogEntries.workspace, imageCatalogEntries.id],
        set: {
          name: values.name,
          intent: values.intent,
          source: values.source,
          declaredSource: values.declaredSource,
        },
      });
    return parsed;
  }

  async delete(namespace: string, entryId: string): Promise<void> {
    await this.db
      .delete(imageCatalogEntries)
      .where(
        and(
          eq(imageCatalogEntries.workspace, namespace),
          eq(imageCatalogEntries.id, entryId),
        ),
      );
  }
}

function toEntry(row: typeof imageCatalogEntries.$inferSelect): ImageCatalogEntry {
  return parseRow(ImageCatalogEntrySchema, {
    id: row.id,
    name: row.name,
    intent: row.intent,
    source: row.source,
    declaredSource: row.declaredSource ?? undefined,
  });
}

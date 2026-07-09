import { and, eq } from 'drizzle-orm';
import {
  ToolCatalogEntrySchema,
  parseRow,
  type ToolCatalogEntry,
  type ToolCatalogRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { toolCatalogEntries } from '../schema/tool-catalog';

/**
 * Postgres-backed ToolCatalogRepository (ADR-0001 tracer-bullet repo).
 * Workspace column carries today's namespace handle. Composite PK
 * (workspace, id) preserves the per-workspace id uniqueness Firestore
 * enforced through document paths.
 *
 * Validation matches the Firestore backend exactly: parse on every read
 * AND every write. `jsonb` cannot enforce `args: string[]` /
 * `env: Record<string, string>` shape, so trusting the database on read
 * would silently accept rows written by a misbehaving sibling repo, a
 * raw SQL fix, or a future schema-drifting migration.
 */
export class PostgresToolCatalogRepository implements ToolCatalogRepository {
  constructor(private readonly db: Database) {}

  async getById(namespace: string, entryId: string): Promise<ToolCatalogEntry | null> {
    const rows = await this.db
      .select()
      .from(toolCatalogEntries)
      .where(
        and(
          eq(toolCatalogEntries.workspace, namespace),
          eq(toolCatalogEntries.id, entryId),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? toEntry(row) : null;
  }

  async list(namespace: string): Promise<ToolCatalogEntry[]> {
    const rows = await this.db
      .select()
      .from(toolCatalogEntries)
      .where(eq(toolCatalogEntries.workspace, namespace));
    return rows.map((r) => toEntry(r));
  }

  async upsert(namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry> {
    const parsed = ToolCatalogEntrySchema.parse(entry);
    const values = {
      workspace: namespace,
      id: parsed.id,
      command: parsed.command,
      args: parsed.args ?? null,
      env: parsed.env ?? null,
      description: parsed.description ?? null,
      // updated_at is set by the set_updated_at() trigger on every UPDATE;
      // for INSERTs the column default `now()` fires.
    };
    await this.db
      .insert(toolCatalogEntries)
      .values(values)
      .onConflictDoUpdate({
        target: [toolCatalogEntries.workspace, toolCatalogEntries.id],
        set: {
          command: values.command,
          args: values.args,
          env: values.env,
          description: values.description,
        },
      });
    return parsed;
  }

  async delete(namespace: string, entryId: string): Promise<void> {
    await this.db
      .delete(toolCatalogEntries)
      .where(
        and(
          eq(toolCatalogEntries.workspace, namespace),
          eq(toolCatalogEntries.id, entryId),
        ),
      );
  }
}

function toEntry(row: typeof toolCatalogEntries.$inferSelect): ToolCatalogEntry {
  return parseRow(ToolCatalogEntrySchema, {
    id: row.id,
    command: row.command,
    args: row.args ?? undefined,
    env: row.env ?? undefined,
    description: row.description ?? undefined,
  });
}

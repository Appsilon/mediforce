import { eq, inArray, sql } from 'drizzle-orm';
import {
  ModelRegistryEntrySchema,
  type ModelRegistryEntry,
  type ModelRegistryMeta,
  type ModelRegistryRepository,
  type CreateModelRegistryEntryInput,
  type UpdateModelRegistryEntryInput,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { modelRegistryEntries, modelRegistryMeta } from '../schema/model-registry';

const META_ID = 'singleton';

/**
 * Postgres-backed ModelRegistryRepository (ADR-0001, PLAN §1.2).
 * Deployment-global table — no workspace column — a sync job keeps it
 * in step with OpenRouter and every workspace reads the same rows.
 *
 * Validation matches the Firestore + in-memory backends: parse on every
 * read AND every write. `pricing` / `inputModalities` / `outputModalities`
 * live in `jsonb`, which cannot enforce shape — trusting the database on
 * read would silently accept rows written by raw SQL or a future
 * schema-drifting migration.
 */
export class PostgresModelRegistryRepository implements ModelRegistryRepository {
  constructor(private readonly db: Database) {}

  async getById(id: string): Promise<ModelRegistryEntry | null> {
    const rows = await this.db
      .select()
      .from(modelRegistryEntries)
      .where(eq(modelRegistryEntries.id, id))
      .limit(1);
    const row = rows[0];
    return row ? ModelRegistryEntrySchema.parse(toEntry(row)) : null;
  }

  async list(): Promise<ModelRegistryEntry[]> {
    const rows = await this.db.select().from(modelRegistryEntries);
    return rows.map((r) => ModelRegistryEntrySchema.parse(toEntry(r)));
  }

  async upsert(entry: CreateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const values = toRowValues(entry);
    await this.db
      .insert(modelRegistryEntries)
      .values(values)
      .onConflictDoUpdate({
        target: modelRegistryEntries.id,
        set: {
          canonicalSlug: values.canonicalSlug,
          name: values.name,
          provider: values.provider,
          contextLength: values.contextLength,
          maxCompletionTokens: values.maxCompletionTokens,
          pricing: values.pricing,
          modality: values.modality,
          inputModalities: values.inputModalities,
          outputModalities: values.outputModalities,
          supportsTools: values.supportsTools,
          supportsVision: values.supportsVision,
          source: values.source,
          requestCount: values.requestCount,
          lastSyncedAt: values.lastSyncedAt,
          retiredAt: values.retiredAt,
          // updated_at advanced by the set_updated_at() trigger on UPDATE.
        },
      });
    const found = await this.getById(entry.id);
    if (!found) throw new Error(`upsert(${entry.id}) returned no row`);
    return found;
  }

  async update(input: UpdateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const { id, ...rest } = input;
    const set: Record<string, unknown> = {};
    if (rest.canonicalSlug !== undefined) set.canonicalSlug = rest.canonicalSlug;
    if (rest.name !== undefined) set.name = rest.name;
    if (rest.provider !== undefined) set.provider = rest.provider;
    if (rest.contextLength !== undefined) set.contextLength = rest.contextLength;
    if (rest.maxCompletionTokens !== undefined) set.maxCompletionTokens = rest.maxCompletionTokens;
    if (rest.pricing !== undefined) set.pricing = rest.pricing;
    if (rest.modality !== undefined) set.modality = rest.modality;
    if (rest.inputModalities !== undefined) set.inputModalities = rest.inputModalities;
    if (rest.outputModalities !== undefined) set.outputModalities = rest.outputModalities;
    if (rest.supportsTools !== undefined) set.supportsTools = rest.supportsTools;
    if (rest.supportsVision !== undefined) set.supportsVision = rest.supportsVision;
    if (rest.source !== undefined) set.source = rest.source;
    if (rest.requestCount !== undefined) set.requestCount = rest.requestCount;
    if (rest.lastSyncedAt !== undefined) set.lastSyncedAt = new Date(rest.lastSyncedAt);
    if (rest.retiredAt !== undefined) set.retiredAt = rest.retiredAt ? new Date(rest.retiredAt) : null;

    if (Object.keys(set).length > 0) {
      await this.db.update(modelRegistryEntries).set(set).where(eq(modelRegistryEntries.id, id));
    }
    const found = await this.getById(id);
    if (!found) throw new Error(`update(${id}) found no row`);
    return found;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(modelRegistryEntries).where(eq(modelRegistryEntries.id, id));
  }

  async bulkUpsert(entries: CreateModelRegistryEntryInput[]): Promise<number> {
    if (entries.length === 0) return 0;
    const batchSize = 500;
    let synced = 0;
    for (let offset = 0; offset < entries.length; offset += batchSize) {
      const chunk = entries.slice(offset, offset + batchSize);
      const values = chunk.map(toRowValues);
      await this.db
        .insert(modelRegistryEntries)
        .values(values)
        .onConflictDoUpdate({
          target: modelRegistryEntries.id,
          set: {
            canonicalSlug: sql`excluded.canonical_slug`,
            name: sql`excluded.name`,
            provider: sql`excluded.provider`,
            contextLength: sql`excluded.context_length`,
            maxCompletionTokens: sql`excluded.max_completion_tokens`,
            pricing: sql`excluded.pricing`,
            modality: sql`excluded.modality`,
            inputModalities: sql`excluded.input_modalities`,
            outputModalities: sql`excluded.output_modalities`,
            supportsTools: sql`excluded.supports_tools`,
            supportsVision: sql`excluded.supports_vision`,
            source: sql`excluded.source`,
            requestCount: sql`excluded.request_count`,
            lastSyncedAt: sql`excluded.last_synced_at`,
            retiredAt: sql`excluded.retired_at`,
          },
        });
      synced += chunk.length;
    }
    return synced;
  }

  async updateRankings(rankings: Array<{ id: string; requestCount: number }>): Promise<number> {
    if (rankings.length === 0) {
      await this.writeMeta();
      return 0;
    }
    // Resolve either by id or by canonicalSlug (parity with Firestore impl).
    const ids = rankings.map((r) => r.id);
    const existing = await this.db
      .select({ id: modelRegistryEntries.id, slug: modelRegistryEntries.canonicalSlug })
      .from(modelRegistryEntries)
      .where(inArray(modelRegistryEntries.id, ids));
    const idSet = new Set(existing.map((e) => e.id));
    const slugRows = await this.db
      .select({ id: modelRegistryEntries.id, slug: modelRegistryEntries.canonicalSlug })
      .from(modelRegistryEntries)
      .where(inArray(modelRegistryEntries.canonicalSlug, ids));
    const slugToId = new Map<string, string>();
    for (const row of slugRows) {
      if (row.slug) slugToId.set(row.slug, row.id);
    }

    const resolved: Array<{ id: string; requestCount: number }> = [];
    for (const { id, requestCount } of rankings) {
      if (idSet.has(id)) {
        resolved.push({ id, requestCount });
      } else if (slugToId.has(id)) {
        resolved.push({ id: slugToId.get(id)!, requestCount });
      }
    }

    let updated = 0;
    const batchSize = 500;
    for (let offset = 0; offset < resolved.length; offset += batchSize) {
      const chunk = resolved.slice(offset, offset + batchSize);
      for (const { id, requestCount } of chunk) {
        await this.db
          .update(modelRegistryEntries)
          .set({ requestCount })
          .where(eq(modelRegistryEntries.id, id));
        updated += 1;
      }
    }
    await this.writeMeta();
    return updated;
  }

  async getMeta(): Promise<ModelRegistryMeta> {
    const rows = await this.db
      .select()
      .from(modelRegistryMeta)
      .where(eq(modelRegistryMeta.id, META_ID))
      .limit(1);
    const row = rows[0];
    if (!row) return { rankingsUpdatedAt: null };
    return {
      rankingsUpdatedAt: row.rankingsUpdatedAt ? row.rankingsUpdatedAt.toISOString() : null,
    };
  }

  private async writeMeta(): Promise<void> {
    const now = new Date();
    await this.db
      .insert(modelRegistryMeta)
      .values({ id: META_ID, rankingsUpdatedAt: now })
      .onConflictDoUpdate({
        target: modelRegistryMeta.id,
        set: { rankingsUpdatedAt: now },
      });
  }
}

function toRowValues(entry: CreateModelRegistryEntryInput) {
  return {
    id: entry.id,
    canonicalSlug: entry.canonicalSlug,
    name: entry.name,
    provider: entry.provider,
    contextLength: entry.contextLength,
    maxCompletionTokens: entry.maxCompletionTokens,
    pricing: entry.pricing,
    modality: entry.modality,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    supportsTools: entry.supportsTools,
    supportsVision: entry.supportsVision,
    source: entry.source,
    requestCount: entry.requestCount,
    lastSyncedAt: new Date(entry.lastSyncedAt),
    retiredAt: entry.retiredAt ? new Date(entry.retiredAt) : null,
  };
}

function toEntry(row: typeof modelRegistryEntries.$inferSelect): ModelRegistryEntry {
  return {
    id: row.id,
    canonicalSlug: row.canonicalSlug,
    name: row.name,
    provider: row.provider,
    contextLength: row.contextLength,
    maxCompletionTokens: row.maxCompletionTokens,
    pricing: row.pricing,
    modality: row.modality,
    inputModalities: row.inputModalities,
    outputModalities: row.outputModalities,
    supportsTools: row.supportsTools,
    supportsVision: row.supportsVision,
    source: row.source as ModelRegistryEntry['source'],
    requestCount: row.requestCount,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
  };
}

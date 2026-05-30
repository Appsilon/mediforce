import {
  ModelRegistryEntrySchema,
  CreateModelRegistryEntryInputSchema,
  UpdateModelRegistryEntryInputSchema,
  type ModelRegistryEntry,
  type ModelRegistryMeta,
  type CreateModelRegistryEntryInput,
  type UpdateModelRegistryEntryInput,
} from '../schemas/model-registry';
import type { ModelRegistryRepository } from '../repositories/model-registry-repository';

export class InMemoryModelRegistryRepository implements ModelRegistryRepository {
  private readonly entries = new Map<string, ModelRegistryEntry>();
  private rankingsUpdatedAt: string | null = null;

  async getById(id: string): Promise<ModelRegistryEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async list(): Promise<ModelRegistryEntry[]> {
    return Array.from(this.entries.values());
  }

  async upsert(entry: CreateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const parsed = CreateModelRegistryEntryInputSchema.parse(entry);
    const now = new Date().toISOString();
    const existing = this.entries.get(parsed.id);
    const stored = ModelRegistryEntrySchema.parse({
      ...parsed,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.entries.set(parsed.id, stored);
    return stored;
  }

  async update(input: UpdateModelRegistryEntryInput): Promise<ModelRegistryEntry> {
    const parsed = UpdateModelRegistryEntryInputSchema.parse(input);
    const existing = this.entries.get(parsed.id);
    if (!existing) throw new Error(`update: model ${parsed.id} not found`);
    const updated = ModelRegistryEntrySchema.parse({
      ...existing,
      ...parsed,
      updatedAt: new Date().toISOString(),
    });
    this.entries.set(parsed.id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
  }

  async bulkUpsert(entries: CreateModelRegistryEntryInput[]): Promise<number> {
    for (const entry of entries) {
      await this.upsert(entry);
    }
    return entries.length;
  }

  async updateRankings(rankings: Array<{ id: string; requestCount: number }>): Promise<number> {
    let updated = 0;
    for (const { id, requestCount } of rankings) {
      const direct = this.entries.get(id);
      if (direct) {
        this.entries.set(id, { ...direct, requestCount });
        updated += 1;
        continue;
      }
      for (const [storedId, entry] of this.entries) {
        if (entry.canonicalSlug === id) {
          this.entries.set(storedId, { ...entry, requestCount });
          updated += 1;
          break;
        }
      }
    }
    this.rankingsUpdatedAt = new Date().toISOString();
    return updated;
  }

  async getMeta(): Promise<ModelRegistryMeta> {
    return { rankingsUpdatedAt: this.rankingsUpdatedAt };
  }
}

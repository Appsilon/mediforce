import type {
  ModelRegistryEntry,
  ModelRegistryMeta,
  CreateModelRegistryEntryInput,
  UpdateModelRegistryEntryInput,
} from '../schemas/model-registry';

export interface ModelRegistryRepository {
  getById(id: string): Promise<ModelRegistryEntry | null>;
  list(): Promise<ModelRegistryEntry[]>;
  upsert(entry: CreateModelRegistryEntryInput): Promise<ModelRegistryEntry>;
  update(input: UpdateModelRegistryEntryInput): Promise<ModelRegistryEntry>;
  delete(id: string): Promise<void>;
  bulkUpsert(entries: CreateModelRegistryEntryInput[]): Promise<number>;
  updateRankings(rankings: Array<{ id: string; requestCount: number }>): Promise<number>;
  getMeta(): Promise<ModelRegistryMeta>;
}

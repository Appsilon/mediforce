import type {
  SkillRegistry,
  CreateSkillRegistryInput,
  UpdateSkillRegistryInput,
} from '../schemas/skill-registry.js';

export type { CreateSkillRegistryInput, UpdateSkillRegistryInput };

export interface SkillRegistryRepository {
  create(input: CreateSkillRegistryInput): Promise<SkillRegistry>;
  upsert(id: string, input: CreateSkillRegistryInput): Promise<SkillRegistry>;
  getById(id: string): Promise<SkillRegistry | null>;
  list(): Promise<SkillRegistry[]>;
  update(id: string, input: UpdateSkillRegistryInput): Promise<SkillRegistry>;
  delete(id: string): Promise<void>;
}

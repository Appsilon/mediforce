import type { Skill, SkillSummary } from '../schemas/skill';

/** What a write supplies; the store owns `createdAt` / `updatedAt`. */
export type SkillWrite = Omit<Skill, 'createdAt' | 'updatedAt'>;

/** Workspace Skills (ADR-0025), keyed on `(namespace, id)`. Visibility is
 *  stored here and enforced by the caller-scoped wrapper, not by this port. */
export interface SkillRepository {
  /** Return the Skill with its files, or null when absent. */
  getById(namespace: string, id: string): Promise<Skill | null>;
  /** Return every Skill in the namespace without file contents, ordered by id. */
  list(namespace: string): Promise<SkillSummary[]>;
  /** Insert a new Skill; null when `(namespace, id)` is already taken. */
  create(skill: SkillWrite): Promise<Skill | null>;
  /** Create or replace a Skill. */
  upsert(skill: SkillWrite): Promise<Skill>;
  /** Remove a Skill. No-op when absent. */
  delete(namespace: string, id: string): Promise<void>;
}

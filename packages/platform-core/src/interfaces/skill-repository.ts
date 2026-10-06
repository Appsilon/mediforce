import type { Skill, SkillSummary } from '../schemas/skill';

/** What a write supplies; the store owns `createdAt` / `updatedAt`. */
export type SkillWrite = Omit<Skill, 'createdAt' | 'updatedAt'>;

/** Restricts a read to `public` Skills, applied in the query itself so a
 *  private row never leaves the store for a caller that may not see it. */
export interface SkillReadScope {
  publicOnly: boolean;
}

/** Workspace Skills (ADR-0025), keyed on `(namespace, id)`. Which Skills a
 *  caller may read is decided by the caller-scoped wrapper, which passes it as
 *  a {@link SkillReadScope}. */
export interface SkillRepository {
  /** Return the Skill with its files, or null when absent. */
  getById(namespace: string, id: string, scope: SkillReadScope): Promise<Skill | null>;
  /** Return every Skill in the namespace without file contents, ordered by id. */
  list(namespace: string, scope: SkillReadScope): Promise<SkillSummary[]>;
  /** Return every `public` Skill in every namespace without file contents,
   *  ordered by namespace then id. */
  listPublic(): Promise<SkillSummary[]>;
  /** Insert a new Skill; null when `(namespace, id)` is already taken. */
  create(skill: SkillWrite): Promise<Skill | null>;
  /** Replace an existing Skill; null when it is absent, so a concurrent
   *  delete is never undone. */
  update(skill: SkillWrite): Promise<Skill | null>;
  /** Remove a Skill. No-op when absent. */
  delete(namespace: string, id: string): Promise<void>;
}

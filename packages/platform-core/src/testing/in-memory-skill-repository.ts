import { SkillSchema, type Skill, type SkillSummary } from '../schemas/skill';
import { fileTreeBytes } from '../schemas/workflow-definition';
import type { SkillReadScope, SkillRepository, SkillWrite } from '../interfaces/skill-repository';

/** In-memory double for SkillRepository, keyed by `${namespace}/${id}`. */
export class InMemorySkillRepository implements SkillRepository {
  private readonly skills = new Map<string, Skill>();

  private key(namespace: string, id: string): string {
    return `${namespace}/${id}`;
  }

  async getById(namespace: string, id: string, scope: SkillReadScope): Promise<Skill | null> {
    const skill = this.skills.get(this.key(namespace, id));
    if (skill === undefined || (scope.publicOnly && skill.visibility !== 'public')) return null;
    return structuredClone(skill);
  }

  async list(namespace: string, scope: SkillReadScope): Promise<SkillSummary[]> {
    return [...this.skills.values()]
      .filter((skill) => skill.namespace === namespace && (scope.publicOnly === false || skill.visibility === 'public'))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map(toSummary);
  }

  async listPublic(): Promise<SkillSummary[]> {
    return [...this.skills.values()]
      .filter((skill) => skill.visibility === 'public')
      .sort((left, right) => (this.key(left.namespace, left.id) < this.key(right.namespace, right.id) ? -1 : 1))
      .map(toSummary);
  }

  async create(skill: SkillWrite): Promise<Skill | null> {
    if (this.skills.has(this.key(skill.namespace, skill.id))) return null;
    return this.write(skill);
  }

  async update(skill: SkillWrite): Promise<Skill | null> {
    if (this.skills.has(this.key(skill.namespace, skill.id)) === false) return null;
    return this.write(skill);
  }

  private write(skill: SkillWrite): Skill {
    const now = new Date().toISOString();
    const existing = this.skills.get(this.key(skill.namespace, skill.id));
    const stored = SkillSchema.parse({
      ...skill,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    this.skills.set(this.key(stored.namespace, stored.id), stored);
    return structuredClone(stored);
  }

  async delete(namespace: string, id: string): Promise<void> {
    this.skills.delete(this.key(namespace, id));
  }
}

function toSummary({ files, ...summary }: Skill): SkillSummary {
  return { ...summary, paths: files.map((file) => file.path), size: fileTreeBytes(files) };
}

import type {
  Skill,
  SkillRepository,
  SkillSummary,
  SkillWrite,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Caller-scoped view of `SkillRepository` (ADR-0025 decision 3). A member of
 * the namespace sees every Skill in it; anyone else sees only its `public`
 * Skills. Writes need workspace write on the Skill's namespace, the same gate
 * as Agents (decision 8).
 */
export class AuthorizedSkillRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: SkillRepository,
  ) {
    super(caller);
  }

  getById = async (namespace: string, id: string): Promise<Skill | null> => {
    const skill = await this.raw.getById(namespace, id);
    if (skill === null) return null;
    return this.canSeeNamespace(namespace) || skill.visibility === 'public' ? skill : null;
  };

  list = async (namespace: string): Promise<SkillSummary[]> => {
    const skills = await this.raw.list(namespace);
    if (this.canSeeNamespace(namespace)) return skills;
    return skills.filter((skill) => skill.visibility === 'public');
  };

  create = async (skill: SkillWrite): Promise<Skill | null> => {
    this.assertNamespaceWrite(skill.namespace);
    return this.raw.create(skill);
  };

  upsert = async (skill: SkillWrite): Promise<Skill> => {
    this.assertNamespaceWrite(skill.namespace);
    return this.raw.upsert(skill);
  };

  delete = async (namespace: string, id: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, id);
  };
}

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

  getById = async (namespace: string, id: string): Promise<Skill | null> =>
    this.raw.getById(namespace, id, { publicOnly: this.canSeeNamespace(namespace) === false });

  list = async (namespace: string): Promise<SkillSummary[]> =>
    this.raw.list(namespace, { publicOnly: this.canSeeNamespace(namespace) === false });

  /** Every `public` Skill in the deployment; readable by any caller. */
  listPublic = async (): Promise<SkillSummary[]> => this.raw.listPublic();

  /** Throws ForbiddenError unless the caller may write the namespace's
   *  Skills. Handlers call it before a guard whose refusal would otherwise
   *  tell a caller without write access which Agents hold a Skill. */
  assertCanWrite = (namespace: string): void => this.assertNamespaceWrite(namespace);

  create = async (skill: SkillWrite): Promise<Skill | null> => {
    this.assertNamespaceWrite(skill.namespace);
    return this.raw.create(skill);
  };

  update = async (skill: SkillWrite): Promise<Skill | null> => {
    this.assertNamespaceWrite(skill.namespace);
    return this.raw.update(skill);
  };

  delete = async (namespace: string, id: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, id);
  };
}

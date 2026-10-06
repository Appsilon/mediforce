import type { CallerScope } from '../../repositories/index';
import type { ListSkillsInput, ListSkillsOutput } from '../../contract/skills';

/** A workspace's Skills; with `includePublic`, followed by every other
 *  workspace's public ones: the Skills an Agent of that workspace may hold. */
export async function listSkills(input: ListSkillsInput, scope: CallerScope): Promise<ListSkillsOutput> {
  const own = await scope.skills.list(input.namespace);
  if (input.includePublic !== true) return { skills: own };
  const others = (await scope.skills.listPublic()).filter((skill) => skill.namespace !== input.namespace);
  return { skills: [...own, ...others] };
}

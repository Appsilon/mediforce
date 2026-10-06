import { NotFoundError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { GetSkillInput, GetSkillOutput } from '../../contract/skills';

export async function getSkill(
  input: GetSkillInput,
  scope: CallerScope,
): Promise<GetSkillOutput> {
  const skill = await scope.skills.getById(input.namespace, input.id);
  if (skill === null) {
    throw new NotFoundError(`Skill '${input.id}' not found in namespace '${input.namespace}'`);
  }
  return { skill };
}

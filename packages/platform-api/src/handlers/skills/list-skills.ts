import type { CallerScope } from '../../repositories/index';
import type { ListSkillsInput, ListSkillsOutput } from '../../contract/skills';

export async function listSkills(
  input: ListSkillsInput,
  scope: CallerScope,
): Promise<ListSkillsOutput> {
  return { skills: await scope.skills.list(input.namespace) };
}

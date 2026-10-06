import { skillManifest } from '@mediforce/platform-core';
import { ConflictError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { CreateSkillInput, CreateSkillOutput } from '../../contract/skills';
import { actorFromCaller } from '../_helpers';
import { skillContentHash } from './_helpers';

export async function createSkill(
  input: CreateSkillInput,
  scope: CallerScope,
): Promise<CreateSkillOutput> {
  const { namespace, files } = input;
  const { name, description } = skillManifest(files);

  const skill = await scope.skills.create({
    namespace,
    id: name,
    name,
    description,
    visibility: input.visibility ?? 'private',
    contentHash: skillContentHash(files),
    files,
  });
  if (skill === null) {
    throw new ConflictError(`Skill '${name}' already exists in namespace '${namespace}'`);
  }

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'skill.created',
    description: `Skill '${skill.id}' created in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: { namespace, id: skill.id, visibility: skill.visibility, paths: files.map((file) => file.path) },
    outputSnapshot: { id: skill.id, contentHash: skill.contentHash },
    basis: 'Skill created via API',
    entityType: 'skill',
    entityId: skill.id,
    namespace,
  });

  return { skill };
}

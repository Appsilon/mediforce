import { skillManifest } from '@mediforce/platform-core';
import { NotFoundError, ValidationError } from '../../errors';
import type { CallerScope } from '../../repositories/index';
import type { UpdateSkillInput, UpdateSkillOutput } from '../../contract/skills';
import { actorFromCaller } from '../_helpers';
import { hasHolders, heldSkillConflict, skillContentHash } from './_helpers';

export async function updateSkill(
  input: UpdateSkillInput,
  scope: CallerScope,
): Promise<UpdateSkillOutput> {
  const { namespace, id } = input;
  const existing = await scope.skills.getById(namespace, id);
  if (existing === null) {
    throw new NotFoundError(`Skill '${id}' not found in namespace '${namespace}'`);
  }

  const files = input.files ?? existing.files;
  const { name, description } = skillManifest(files);
  if (name !== id) {
    throw new ValidationError(
      `SKILL.md names '${name}', but this is skill '${id}'. The name is fixed at create; create a new skill to rename it.`,
    );
  }

  const visibility = input.visibility ?? existing.visibility;
  if (visibility === 'private' && existing.visibility === 'public') {
    // A private Skill may be held only by its own workspace's private Agents
    // (ADR-0025 decision 3). Agents the caller cannot see are all in other
    // workspaces, so every one of them would lose the skill.
    scope.skills.assertCanWrite(namespace);
    const holders = await scope.agentDefinitions.holdersOfSkill(namespace, id);
    const outside = {
      visible: holders.visible.filter((agent) => agent.visibility === 'public' || agent.namespace !== namespace),
      hiddenCount: holders.hiddenCount,
    };
    if (hasHolders(outside)) {
      throw heldSkillConflict(
        `Skill '${id}' cannot be made private while public agents or agents in other workspaces hold it`,
        outside,
      );
    }
  }

  const skill = await scope.skills.update({
    namespace,
    id,
    name,
    description,
    visibility,
    contentHash: skillContentHash(files),
    files,
  });
  if (skill === null) {
    throw new NotFoundError(`Skill '${id}' not found in namespace '${namespace}'`);
  }

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'skill.updated',
    description: `Skill '${id}' updated in namespace '${namespace}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      namespace,
      id,
      patchKeys: Object.keys(input).filter((key) => key !== 'namespace' && key !== 'id'),
      previousContentHash: existing.contentHash,
      previousVisibility: existing.visibility,
    },
    outputSnapshot: { id, contentHash: skill.contentHash, visibility: skill.visibility },
    basis: 'Skill updated via API',
    entityType: 'skill',
    entityId: id,
    namespace,
  });

  return { skill };
}

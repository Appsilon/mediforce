import type { CallerScope } from '../../repositories/index';
import type { DeleteSkillInput, DeleteSkillOutput } from '../../contract/skills';
import { actorFromCaller } from '../_helpers';
import { hasHolders, heldSkillConflict } from './_helpers';

export async function deleteSkill(
  input: DeleteSkillInput,
  scope: CallerScope,
): Promise<DeleteSkillOutput> {
  // A cascading delete would silently change other workspaces' Agents, so
  // the delete is refused while any Agent holds the skill (ADR-0025 decision
  // 7). Write access is checked first: the refusal names holding Agents.
  scope.skills.assertCanWrite(input.namespace);
  const holders = await scope.agentDefinitions.holdersOfSkill(input.namespace, input.id);
  if (hasHolders(holders)) {
    throw heldSkillConflict(`Skill '${input.id}' cannot be deleted while agents hold it`, holders);
  }

  // Fetch first so deleting an absent skill stays a silent no-op rather than
  // writing an audit entry for nothing.
  const existing = await scope.skills.getById(input.namespace, input.id);
  await scope.skills.delete(input.namespace, input.id);

  if (existing !== null) {
    await scope.system.audit.append({
      ...actorFromCaller(scope),
      action: 'skill.deleted',
      description: `Skill '${input.id}' deleted from namespace '${input.namespace}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { namespace: input.namespace, id: input.id },
      outputSnapshot: { id: input.id, contentHash: existing.contentHash },
      basis: 'Skill deleted via API',
      entityType: 'skill',
      entityId: input.id,
      namespace: input.namespace,
    });
  }

  return { success: true };
}

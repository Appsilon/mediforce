import type { CallerScope } from '../../repositories/index';
import type { DeleteSkillInput, DeleteSkillOutput } from '../../contract/skills';
import { actorFromCaller } from '../_helpers';

export async function deleteSkill(
  input: DeleteSkillInput,
  scope: CallerScope,
): Promise<DeleteSkillOutput> {
  // Refusing while an Agent holds this skill (ADR-0025 decision 7) lands with
  // #1461, which adds AgentDefinition.skills.
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

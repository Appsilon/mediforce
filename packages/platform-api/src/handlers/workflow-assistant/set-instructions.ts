import type {
  SetAssistantInstructionsInput,
  SetAssistantInstructionsOutput,
} from '../../contract/workflow-assistant';
import type { CallerScope } from '../../repositories/index';
import { resolveTargetUid } from '../_helpers';

/**
 * Replace the caller's standing instructions for one workspace. An empty
 * string clears them.
 *
 * Deliberately unaudited: this is a person's own note to their own assistant,
 * not a change to anything the workspace shares. Every turn it shapes is
 * already recorded by `workflow_assistant.prompt`.
 */
export async function setAssistantInstructions(
  input: SetAssistantInstructionsInput,
  scope: CallerScope,
): Promise<SetAssistantInstructionsOutput> {
  const uid = resolveTargetUid(input, scope, 'assistant instructions');
  await scope.assistantInstructions.set(input.namespace, uid, input.instructions);
  return { ok: true };
}

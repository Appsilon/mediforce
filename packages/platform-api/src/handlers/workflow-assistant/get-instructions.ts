import type {
  GetAssistantInstructionsInput,
  GetAssistantInstructionsOutput,
} from '../../contract/workflow-assistant';
import type { CallerScope } from '../../repositories/index';
import { resolveTargetUid } from '../_helpers';

/**
 * The caller's own standing instructions for the assistant in one workspace.
 *
 * `''` covers both "saved nothing" and "not a member here" — the wrapper
 * answers empty rather than refusing, so a read cannot be used to discover
 * which workspaces exist.
 */
export async function getAssistantInstructions(
  input: GetAssistantInstructionsInput,
  scope: CallerScope,
): Promise<GetAssistantInstructionsOutput> {
  const uid = resolveTargetUid(input, scope, 'assistant instructions');
  const instructions = await scope.assistantInstructions.get(input.namespace, uid);
  return { instructions };
}

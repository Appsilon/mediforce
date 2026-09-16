import type { CallerScope } from '../../../repositories/index';
import type { OpenRouterChatMessage } from '../../../services/openrouter-client';

/**
 * The caller's own standing instructions for this workspace, as the system
 * message that carries them — or nothing at all when they have saved none.
 *
 * Loaded here rather than accepted from the request: that is what makes them
 * hold for a whole session, survive a reload, and still be there tomorrow,
 * and it keeps the system prompt out of reach of anything a client can post.
 * apiKey callers get nothing — a system actor has no user whose conventions
 * these would be.
 *
 * Returned as an array so a caller can spread it into the message list. It
 * belongs AFTER the static prompt: that prompt is tens of kilobytes and
 * byte-identical every turn, so anything variable placed before it would cost
 * a prompt-cache miss on every request.
 */
export async function callerInstructionMessages(
  scope: CallerScope,
  namespace: string,
): Promise<OpenRouterChatMessage[]> {
  if (scope.caller.kind !== 'user') return [];
  const instructions = await scope.assistantInstructions.get(namespace, scope.caller.uid);
  if (instructions.trim() === '') return [];
  return [{ role: 'system', content: frameInstructions(instructions) }];
}

/**
 * The instructions plus what authority they carry.
 *
 * Without the second paragraph this is an open invitation to write a workflow
 * that cannot be saved: the person's conventions are about taste, and the
 * graph gate is about validity, so an instruction that collides with the
 * schema has to lose and be reported rather than silently produce a canvas
 * that fails on Save.
 */
function frameInstructions(instructions: string): string {
  return `## This user's standing instructions for this workspace

The person you are working with keeps these conventions for workflows they build here. They are more specific than the general guidance above — where the two differ about naming, defaults, or which shape to reach for, these win.

They refine choices; they do not relax rules. Every step must still be valid, the graph must still connect, and every tool call must still satisfy its schema. If an instruction here cannot be honoured without producing a workflow that would fail validation, build the valid one and say plainly in your reply which instruction you could not follow and why.

${instructions.trim()}`;
}

// One line in the assistant pane.
export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  // What the reducer changed on the canvas, rendered under the reply.
  changes?: string;
  // Written by the pane rather than by the model: the plan it is about to build, a note that something did not land, a halted turn.
  narration?: boolean;
  // Narration the person has to act on — a role nobody holds, a graph that will not save.
  tone?: 'warning';
}

// The conversation as the model should see it.
export function messagesForModel(
  messages: AssistantMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((message) => message.narration !== true && message.content !== '')
    .map((message) => ({ role: message.role, content: message.content }));
}

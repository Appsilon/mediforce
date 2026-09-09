/** One line in the assistant pane. Some of them the model wrote, some the pane
 *  wrote about it — and only the model's own belong in the next request. */
export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
  /** What the reducer changed on the canvas, rendered under the reply. */
  changes?: string;
  /** Written by the pane rather than by the model: the plan it is about to
   *  build, a note that something did not land, a halted turn. */
  narration?: boolean;
}

/**
 * The conversation as the model should see it. Narration is dropped: the plan
 * summary reads as the assistant's own last turn, and a model that finds it
 * already said what it was going to do answers "shall I go ahead?" instead of
 * building. It was intermittent because the plan message reached the request
 * only when React had committed it before the build started.
 */
export function messagesForModel(
  messages: AssistantMessage[],
): { role: 'user' | 'assistant'; content: string }[] {
  return messages
    .filter((message) => message.narration !== true && message.content !== '')
    .map((message) => ({ role: message.role, content: message.content }));
}

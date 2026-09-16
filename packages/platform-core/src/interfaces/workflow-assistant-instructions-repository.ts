/**
 * Standing instructions one person keeps for the workflow assistant in one
 * workspace (`workflow_assistant_instructions`).
 *
 * Per `(workspace, uid)` rather than per workspace: the text is how *this*
 * author wants workflows built — naming, house defaults, the shape they always
 * reach for — and two people editing the same canvas rarely want the same
 * answer. A workspace-wide version would also make it readable by everyone,
 * which is the opposite of a personal scratchpad.
 *
 * The assistant reads this on every turn rather than taking it from the
 * request, so it holds for a whole session, survives a reload, and is still
 * there tomorrow — and no client can put words in the system prompt.
 */
export interface WorkflowAssistantInstructions {
  readonly namespace: string;
  readonly uid: string;
  readonly instructions: string;
  readonly updatedAt: string;
}

export interface WorkflowAssistantInstructionsRepository {
  /** `null` when this user has saved nothing for this workspace. */
  get(namespace: string, uid: string): Promise<WorkflowAssistantInstructions | null>;

  /**
   * Upsert the text. An empty string is the cleared state — it deletes the row
   * rather than storing a blank one, so "saved nothing" has exactly one
   * representation for every reader.
   */
  set(namespace: string, uid: string, instructions: string): Promise<void>;
}

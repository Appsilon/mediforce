import { and, eq, sql } from 'drizzle-orm';
import type {
  WorkflowAssistantInstructions,
  WorkflowAssistantInstructionsRepository,
} from '@mediforce/platform-core';
import type { Database } from '../client';
import { workflowAssistantInstructions } from '../schema/workflow-assistant-instructions';

/**
 * Postgres-backed per-(workspace, user) assistant instructions.
 *
 * `set('')` deletes rather than storing a blank row, so "this person saved
 * nothing here" has one representation and a cleared textarea leaves no
 * residue behind.
 */
export class PostgresWorkflowAssistantInstructionsRepository
implements WorkflowAssistantInstructionsRepository {
  constructor(private readonly db: Database) {}

  async get(namespace: string, uid: string): Promise<WorkflowAssistantInstructions | null> {
    const rows = await this.db
      .select()
      .from(workflowAssistantInstructions)
      .where(and(
        eq(workflowAssistantInstructions.workspace, namespace),
        eq(workflowAssistantInstructions.uid, uid),
      ))
      .limit(1);
    const row = rows[0];
    if (row === undefined) return null;
    return {
      namespace: row.workspace,
      uid: row.uid,
      instructions: row.instructions,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async set(namespace: string, uid: string, instructions: string): Promise<void> {
    if (instructions === '') {
      await this.db
        .delete(workflowAssistantInstructions)
        .where(and(
          eq(workflowAssistantInstructions.workspace, namespace),
          eq(workflowAssistantInstructions.uid, uid),
        ));
      return;
    }
    await this.db
      .insert(workflowAssistantInstructions)
      .values({ workspace: namespace, uid, instructions })
      .onConflictDoUpdate({
        target: [workflowAssistantInstructions.workspace, workflowAssistantInstructions.uid],
        set: { instructions, updatedAt: sql`now()` },
      });
  }
}

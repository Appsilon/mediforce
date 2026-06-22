import { and, eq } from 'drizzle-orm';
import { WorkflowSecretsSchema, type WorkflowSecretsRepository } from '@mediforce/platform-core';
import type { Database } from '../client';
import { workflowSecrets } from '../schema/workflow-secret';
import { encrypt, decrypt } from '../../crypto/secrets-cipher';

/**
 * Postgres-backed WorkflowSecretsRepository (ADR-0001, PLAN §1.2).
 *
 * Firestore stored every key in one `{workflowName}` document map. Postgres
 * uses one row per (workspace, workflow_name, key) so writes don't have to
 * read-modify-write the whole map. Values are AES-256-GCM ciphertext
 * (encrypted on write, decrypted on read) — matching the Firestore backend.
 *
 * Precedence (workflow wins over namespace on key collision) lives in the
 * service layer above — this repo just stores rows.
 */
export class PostgresWorkflowSecretsRepository implements WorkflowSecretsRepository {
  constructor(private readonly db: Database) {}

  async getSecrets(namespace: string, workflowName: string): Promise<Record<string, string>> {
    const rows = await this.db
      .select()
      .from(workflowSecrets)
      .where(and(eq(workflowSecrets.workspace, namespace), eq(workflowSecrets.workflowName, workflowName)));
    const result: Record<string, string> = {};
    for (const row of rows) {
      try {
        result[row.key] = decrypt(row.encryptedValue);
      } catch (cause) {
        const rootMessage = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to decrypt workflow secret '${row.key}': ${rootMessage}`, { cause });
      }
    }
    WorkflowSecretsSchema.parse({
      workflowName,
      namespace,
      secrets: rows.reduce<Record<string, string>>((acc, r) => {
        acc[r.key] = r.encryptedValue;
        return acc;
      }, {}),
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  async getSecretKeys(namespace: string, workflowName: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: workflowSecrets.key })
      .from(workflowSecrets)
      .where(and(eq(workflowSecrets.workspace, namespace), eq(workflowSecrets.workflowName, workflowName)));
    return rows.map((r) => r.key);
  }

  async setSecrets(namespace: string, workflowName: string, secrets: Record<string, string>): Promise<void> {
    WorkflowSecretsSchema.parse({
      workflowName,
      namespace,
      secrets,
      updatedAt: new Date().toISOString(),
    });
    await this.db.transaction(async (tx) => {
      await tx
        .delete(workflowSecrets)
        .where(and(eq(workflowSecrets.workspace, namespace), eq(workflowSecrets.workflowName, workflowName)));
      const entries = Object.entries(secrets);
      if (entries.length === 0) return;
      await tx.insert(workflowSecrets).values(
        entries.map(([key, value]) => ({
          workspace: namespace,
          workflowName,
          key,
          encryptedValue: encrypt(value),
        })),
      );
    });
  }

  async deleteSecrets(namespace: string, workflowName: string): Promise<void> {
    await this.db
      .delete(workflowSecrets)
      .where(and(eq(workflowSecrets.workspace, namespace), eq(workflowSecrets.workflowName, workflowName)));
  }

  async deleteSecret(namespace: string, workflowName: string, key: string): Promise<void> {
    await this.db
      .delete(workflowSecrets)
      .where(
        and(
          eq(workflowSecrets.workspace, namespace),
          eq(workflowSecrets.workflowName, workflowName),
          eq(workflowSecrets.key, key),
        ),
      );
  }

  async upsertSecret(namespace: string, workflowName: string, key: string, value: string): Promise<void> {
    WorkflowSecretsSchema.parse({
      workflowName,
      namespace,
      secrets: { [key]: value },
      updatedAt: new Date().toISOString(),
    });
    await this.db
      .insert(workflowSecrets)
      .values({
        workspace: namespace,
        workflowName,
        key,
        encryptedValue: encrypt(value),
      })
      .onConflictDoUpdate({
        target: [workflowSecrets.workspace, workflowSecrets.workflowName, workflowSecrets.key],
        set: { encryptedValue: encrypt(value) },
      });
  }
}

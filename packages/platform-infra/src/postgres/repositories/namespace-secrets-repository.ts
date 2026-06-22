import { and, eq } from 'drizzle-orm';
import { NamespaceSecretsSchema, type NamespaceSecretsRepository } from '@mediforce/platform-core';
import type { Database } from '../client';
import { namespaceSecrets } from '../schema/namespace-secret';
import { encrypt, decrypt } from '../../crypto/secrets-cipher';

/**
 * Postgres-backed NamespaceSecretsRepository (ADR-0001, PLAN §1.2).
 *
 * Firestore stored every key in one `_config` document map. Postgres uses one
 * row per (workspace, key) so writes don't have to read-modify-write the whole
 * map. Values are AES-256-GCM ciphertext (encrypted on write, decrypted on
 * read) — matching the Firestore backend exactly.
 *
 * Validation matches the Firestore + in-memory backends: parse on every read
 * AND every write through `NamespaceSecretsSchema` so the (namespace, key,
 * value) shape stays consistent across backends.
 */
export class PostgresNamespaceSecretsRepository implements NamespaceSecretsRepository {
  constructor(private readonly db: Database) {}

  async getSecrets(namespace: string): Promise<Record<string, string>> {
    const rows = await this.db.select().from(namespaceSecrets).where(eq(namespaceSecrets.workspace, namespace));
    const result: Record<string, string> = {};
    for (const row of rows) {
      try {
        result[row.key] = decrypt(row.encryptedValue);
      } catch (cause) {
        const rootMessage = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to decrypt namespace secret '${row.key}': ${rootMessage}`, { cause });
      }
    }
    // Re-validate the assembled shape so parse failures surface here, not
    // somewhere downstream where the bad row is hard to trace.
    NamespaceSecretsSchema.parse({
      namespace,
      secrets: rows.reduce<Record<string, string>>((acc, r) => {
        acc[r.key] = r.encryptedValue;
        return acc;
      }, {}),
      updatedAt: new Date().toISOString(),
    });
    return result;
  }

  async getSecretKeys(namespace: string): Promise<string[]> {
    const rows = await this.db
      .select({ key: namespaceSecrets.key })
      .from(namespaceSecrets)
      .where(eq(namespaceSecrets.workspace, namespace));
    return rows.map((r) => r.key);
  }

  async setSecrets(namespace: string, secrets: Record<string, string>): Promise<void> {
    NamespaceSecretsSchema.parse({
      namespace,
      secrets,
      updatedAt: new Date().toISOString(),
    });
    await this.db.transaction(async (tx) => {
      await tx.delete(namespaceSecrets).where(eq(namespaceSecrets.workspace, namespace));
      const entries = Object.entries(secrets);
      if (entries.length === 0) return;
      await tx.insert(namespaceSecrets).values(
        entries.map(([key, value]) => ({
          workspace: namespace,
          key,
          encryptedValue: encrypt(value),
        })),
      );
    });
  }

  async upsertSecret(namespace: string, key: string, value: string): Promise<void> {
    NamespaceSecretsSchema.parse({
      namespace,
      secrets: { [key]: value },
      updatedAt: new Date().toISOString(),
    });
    await this.db
      .insert(namespaceSecrets)
      .values({
        workspace: namespace,
        key,
        encryptedValue: encrypt(value),
      })
      .onConflictDoUpdate({
        target: [namespaceSecrets.workspace, namespaceSecrets.key],
        set: { encryptedValue: encrypt(value) },
      });
  }

  async deleteSecret(namespace: string, key: string): Promise<void> {
    await this.db
      .delete(namespaceSecrets)
      .where(and(eq(namespaceSecrets.workspace, namespace), eq(namespaceSecrets.key, key)));
  }
}

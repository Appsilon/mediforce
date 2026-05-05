import {
  WorkflowSecretsSchema,
  type WorkflowSecrets,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';
import { encrypt, decrypt } from '../crypto/secrets-cipher.js';

/**
 * Stores workflow secrets per namespace.
 * Values are AES-256-GCM encrypted at rest.
 *
 * Path: namespaces/{handle}/workflowSecrets/{workflowName}
 */
export class FirestoreWorkflowSecretsRepository {
  constructor(private readonly db: Firestore) {}

  private docRef(namespace: string, workflowName: string) {
    return this.db
      .collection('namespaces')
      .doc(namespace)
      .collection('workflowSecrets')
      .doc(workflowName);
  }

  private decryptSecrets(encrypted: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(encrypted)) {
      try {
        result[key] = decrypt(value);
      } catch (cause) {
        const rootMessage = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to decrypt workflow secret '${key}': ${rootMessage}`, { cause });
      }
    }
    return result;
  }

  private encryptSecrets(plaintext: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(plaintext)) {
      result[key] = encrypt(value);
    }
    return result;
  }

  async getSecrets(namespace: string, workflowName: string): Promise<Record<string, string>> {
    const snapshot = await this.docRef(namespace, workflowName).get();
    if (!snapshot.exists) return {};
    const data = snapshot.data();
    if (!data?.secrets || typeof data.secrets !== 'object') return {};
    const parsed = WorkflowSecretsSchema.parse(data);
    return this.decryptSecrets(parsed.secrets);
  }

  async getSecretKeys(namespace: string, workflowName: string): Promise<string[]> {
    const snapshot = await this.docRef(namespace, workflowName).get();
    if (!snapshot.exists) return [];
    const data = snapshot.data();
    if (!data?.secrets || typeof data.secrets !== 'object') return [];
    const parsed = WorkflowSecretsSchema.parse(data);
    return Object.keys(parsed.secrets);
  }

  async setSecrets(
    namespace: string,
    workflowName: string,
    secrets: Record<string, string>,
  ): Promise<void> {
    const data: WorkflowSecrets = {
      workflowName,
      namespace,
      secrets: this.encryptSecrets(secrets),
      updatedAt: new Date().toISOString(),
    };
    await this.docRef(namespace, workflowName).set(data);
  }

  async deleteSecrets(namespace: string, workflowName: string): Promise<void> {
    await this.docRef(namespace, workflowName).delete();
  }

  async upsertSecret(namespace: string, workflowName: string, key: string, value: string): Promise<void> {
    const ref = this.docRef(namespace, workflowName);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const existing: Record<string, string> = {};
      if (snapshot.exists) {
        const data = snapshot.data();
        if (data?.secrets && typeof data.secrets === 'object') {
          const parsed = WorkflowSecretsSchema.parse(data);
          Object.assign(existing, this.decryptSecrets(parsed.secrets));
        }
      }
      existing[key] = value;
      const doc: WorkflowSecrets = {
        workflowName,
        namespace,
        secrets: this.encryptSecrets(existing),
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, doc);
    });
  }

  async deleteSecret(namespace: string, workflowName: string, key: string): Promise<void> {
    const ref = this.docRef(namespace, workflowName);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data();
      if (!data?.secrets || typeof data.secrets !== 'object') return;
      const parsed = WorkflowSecretsSchema.parse(data);
      const existing = this.decryptSecrets(parsed.secrets);
      delete existing[key];
      const doc: WorkflowSecrets = {
        workflowName,
        namespace,
        secrets: this.encryptSecrets(existing),
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, doc);
    });
  }
}

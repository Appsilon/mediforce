import {
  NamespaceSecretsSchema,
  type NamespaceSecrets,
} from '@mediforce/platform-core';
import type { Firestore } from 'firebase-admin/firestore';
import { encrypt, decrypt } from '../crypto/secrets-cipher.js';

/**
 * Namespace-level secrets shared across all workflows in a namespace.
 * Values are AES-256-GCM encrypted at rest.
 *
 * Path: namespaces/{handle}/namespaceSecrets/_config
 */
export class FirestoreNamespaceSecretsRepository {
  constructor(private readonly db: Firestore) {}

  private docRef(namespace: string) {
    return this.db
      .collection('namespaces')
      .doc(namespace)
      .collection('namespaceSecrets')
      .doc('_config');
  }

  private decryptSecrets(encrypted: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(encrypted)) {
      try {
        result[key] = decrypt(value);
      } catch (cause) {
        const rootMessage = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to decrypt namespace secret '${key}': ${rootMessage}`, { cause });
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

  async getSecrets(namespace: string): Promise<Record<string, string>> {
    const snapshot = await this.docRef(namespace).get();
    if (!snapshot.exists) return {};
    const data = snapshot.data();
    if (!data?.secrets || typeof data.secrets !== 'object') return {};
    const parsed = NamespaceSecretsSchema.parse(data);
    return this.decryptSecrets(parsed.secrets);
  }

  async getSecretKeys(namespace: string): Promise<string[]> {
    const snapshot = await this.docRef(namespace).get();
    if (!snapshot.exists) return [];
    const data = snapshot.data();
    if (!data?.secrets || typeof data.secrets !== 'object') return [];
    const parsed = NamespaceSecretsSchema.parse(data);
    return Object.keys(parsed.secrets);
  }

  async setSecrets(namespace: string, secrets: Record<string, string>): Promise<void> {
    const data: NamespaceSecrets = {
      namespace,
      secrets: this.encryptSecrets(secrets),
      updatedAt: new Date().toISOString(),
    };
    await this.docRef(namespace).set(data);
  }

  async upsertSecret(namespace: string, key: string, value: string): Promise<void> {
    const ref = this.docRef(namespace);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const existing: Record<string, string> = {};
      if (snapshot.exists) {
        const data = snapshot.data();
        if (data?.secrets && typeof data.secrets === 'object') {
          const parsed = NamespaceSecretsSchema.parse(data);
          Object.assign(existing, this.decryptSecrets(parsed.secrets));
        }
      }
      existing[key] = value;
      const doc: NamespaceSecrets = {
        namespace,
        secrets: this.encryptSecrets(existing),
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, doc);
    });
  }

  async deleteSecret(namespace: string, key: string): Promise<void> {
    const ref = this.docRef(namespace);
    await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) return;
      const data = snapshot.data();
      if (!data?.secrets || typeof data.secrets !== 'object') return;
      const parsed = NamespaceSecretsSchema.parse(data);
      const existing = this.decryptSecrets(parsed.secrets);
      delete existing[key];
      const doc: NamespaceSecrets = {
        namespace,
        secrets: this.encryptSecrets(existing),
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, doc);
    });
  }
}

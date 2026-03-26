import {
  WorkflowSecretsSchema,
  type WorkflowSecrets,
} from '@mediforce/platform-core';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  type Firestore,
} from 'firebase/firestore';
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
    return doc(this.db, 'namespaces', namespace, 'workflowSecrets', workflowName);
  }

  private decryptSecrets(encrypted: Record<string, string>): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(encrypted)) {
      result[key] = decrypt(value);
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
    const snapshot = await getDoc(this.docRef(namespace, workflowName));
    if (!snapshot.exists()) return {};
    const data = snapshot.data();
    if (!data?.secrets || typeof data.secrets !== 'object') return {};
    const parsed = WorkflowSecretsSchema.parse(data);
    return this.decryptSecrets(parsed.secrets);
  }

  async getSecretKeys(namespace: string, workflowName: string): Promise<string[]> {
    const snapshot = await getDoc(this.docRef(namespace, workflowName));
    if (!snapshot.exists()) return [];
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
    await setDoc(this.docRef(namespace, workflowName), data);
  }

  async deleteSecrets(namespace: string, workflowName: string): Promise<void> {
    await deleteDoc(this.docRef(namespace, workflowName));
  }
}

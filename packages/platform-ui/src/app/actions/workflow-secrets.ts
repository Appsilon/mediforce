'use server';

import { getFirestoreDb, FirestoreWorkflowSecretsRepository } from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  // Ensure Firebase is initialized before accessing Firestore
  getPlatformServices();
  return new FirestoreWorkflowSecretsRepository(getFirestoreDb());
}

/** Get secret keys only (safe for client — no values exposed) */
export async function getWorkflowSecretKeys(
  namespace: string,
  workflowName: string,
): Promise<string[]> {
  return getRepo().getSecretKeys(namespace, workflowName);
}

/** Get full secrets (values included) — for the secrets management page */
export async function getWorkflowSecrets(
  namespace: string,
  workflowName: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace, workflowName);
}

/** Save all secrets atomically */
export async function saveWorkflowSecrets(
  namespace: string,
  workflowName: string,
  secrets: Record<string, string>,
): Promise<void> {
  await getRepo().setSecrets(namespace, workflowName, secrets);
}

/** Get secrets for runtime resolution (called from execute-agent-step) */
export async function getWorkflowSecretsForRuntime(
  namespace: string,
  workflowName: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace, workflowName);
}

'use server';

import {
  getFirestoreDb,
  FirestoreWorkflowSecretsRepository,
  FirestoreNamespaceRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  getPlatformServices();
  return new FirestoreWorkflowSecretsRepository(getFirestoreDb());
}

async function requireNamespaceMember(namespace: string, userId: string): Promise<void> {
  getPlatformServices();
  const namespaceRepo = new FirestoreNamespaceRepository(getFirestoreDb());
  const member = await namespaceRepo.getMember(namespace, userId);
  if (!member) {
    throw new Error('Not a member of this namespace');
  }
}

/** Get secret keys only (safe for client — no values exposed) */
export async function getWorkflowSecretKeys(
  namespace: string,
  workflowName: string,
  userId: string,
): Promise<string[]> {
  await requireNamespaceMember(namespace, userId);
  return getRepo().getSecretKeys(namespace, workflowName);
}

/** Get full secrets (values included) — for the secrets management page */
export async function getWorkflowSecrets(
  namespace: string,
  workflowName: string,
  userId: string,
): Promise<Record<string, string>> {
  await requireNamespaceMember(namespace, userId);
  return getRepo().getSecrets(namespace, workflowName);
}

/** Save all secrets atomically */
export async function saveWorkflowSecrets(
  namespace: string,
  workflowName: string,
  secrets: Record<string, string>,
  userId: string,
): Promise<void> {
  await requireNamespaceMember(namespace, userId);
  await getRepo().setSecrets(namespace, workflowName, secrets);
}

/** Get secrets for runtime resolution (called server-side from execute-agent-step — no user auth needed) */
export const getWorkflowSecretsForRuntime = async (
  namespace: string,
  workflowName: string,
): Promise<Record<string, string>> => getRepo().getSecrets(namespace, workflowName);

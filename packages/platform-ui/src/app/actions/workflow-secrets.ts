'use server';

import {
  getAdminFirestore,
  FirestoreWorkflowSecretsRepository,
  FirestoreNamespaceRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  getPlatformServices();
  return new FirestoreWorkflowSecretsRepository(getAdminFirestore());
}

async function requireNamespaceMember(namespace: string, userId: string): Promise<void> {
  getPlatformServices();
  const db = getAdminFirestore();
  const namespaceRepo = new FirestoreNamespaceRepository(db);

  const member = await namespaceRepo.getMember(namespace, userId);
  if (member) return;

  const ns = await namespaceRepo.getNamespace(namespace);
  if (ns?.type === 'personal' && ns.linkedUserId === userId) return;

  throw new Error('Not a member of this namespace');
}

/** Get full secrets (values included) — for the secrets management page.
 *  Workflow-secret value reveal + bulk save stay as Server Actions until a
 *  dedicated migration ticket; the read-companion endpoints in Phase 2.5
 *  only cover key listing. */
export async function getWorkflowSecrets(
  namespace: string,
  workflowName: string,
  userId: string,
): Promise<Record<string, string>> {
  await requireNamespaceMember(namespace, userId);
  return getRepo().getSecrets(namespace, workflowName);
}

/** Save all secrets atomically. See `getWorkflowSecrets` for the migration
 *  carve-out — bulk replace surface is out of Phase 2.5 scope. */
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

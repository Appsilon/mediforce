'use server';

import type { WorkflowSecretsRepository } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo(): WorkflowSecretsRepository {
  return getPlatformServices().secretsRepo;
}

async function requireNamespaceMember(namespace: string, userId: string): Promise<void> {
  const { namespaceRepo } = getPlatformServices();

  // Check member doc first
  const member = await namespaceRepo.getMember(namespace, userId);
  if (member) return;

  // Fallback: personal namespaces created before members subcollection may lack a member doc
  const ns = await namespaceRepo.getNamespace(namespace);
  if (ns?.type === 'personal' && ns.linkedUserId === userId) return;

  throw new Error('Not a member of this namespace');
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

/** Get secret keys for multiple workflows in one round-trip */
export async function getWorkflowSecretKeysBatch(
  namespace: string,
  workflowNames: string[],
  userId: string,
): Promise<Record<string, string[]>> {
  await requireNamespaceMember(namespace, userId);
  const repo = getRepo();
  const results = await Promise.all(
    workflowNames.map(async (name) => {
      const keys = await repo.getSecretKeys(namespace, name);
      return [name, keys] as const;
    }),
  );
  return Object.fromEntries(results);
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

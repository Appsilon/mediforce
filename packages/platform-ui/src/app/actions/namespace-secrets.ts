'use server';

import {
  getAdminFirestore,
  FirestoreNamespaceSecretsRepository,
  FirestoreNamespaceRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  getPlatformServices();
  return new FirestoreNamespaceSecretsRepository(getAdminFirestore());
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

export async function getNamespaceSecretKeys(
  namespace: string,
  userId: string,
): Promise<string[]> {
  await requireNamespaceMember(namespace, userId);
  return getRepo().getSecretKeys(namespace);
}

export async function getNamespaceSecrets(
  namespace: string,
  userId: string,
): Promise<Record<string, string>> {
  await requireNamespaceMember(namespace, userId);
  return getRepo().getSecrets(namespace);
}

export async function saveNamespaceSecrets(
  namespace: string,
  secrets: Record<string, string>,
  userId: string,
): Promise<void> {
  await requireNamespaceMember(namespace, userId);
  await getRepo().setSecrets(namespace, secrets);
}

export async function getNamespaceSecretsForRuntime(
  namespace: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace);
}

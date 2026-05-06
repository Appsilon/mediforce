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

export interface SecretPreview {
  key: string;
  preview: string;
}

function maskValue(value: string): string {
  if (value.length > 12) {
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  }
  return '•'.repeat(8);
}

export async function getNamespaceSecretPreviews(
  namespace: string,
  userId: string,
): Promise<SecretPreview[]> {
  await requireNamespaceMember(namespace, userId);
  const secrets = await getRepo().getSecrets(namespace);
  return Object.entries(secrets).map(([key, value]) => ({
    key,
    preview: maskValue(value),
  }));
}

export async function upsertNamespaceSecret(
  namespace: string,
  key: string,
  value: string,
  userId: string,
): Promise<void> {
  await requireNamespaceMember(namespace, userId);
  await getRepo().upsertSecret(namespace, key, value);
}

export async function deleteNamespaceSecret(
  namespace: string,
  key: string,
  userId: string,
): Promise<void> {
  await requireNamespaceMember(namespace, userId);
  await getRepo().deleteSecret(namespace, key);
}

export async function getNamespaceSecretsForRuntime(
  namespace: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace);
}

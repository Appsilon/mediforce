'use server';

import type { NamespaceSecretsRepository } from '@mediforce/platform-core';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo(): NamespaceSecretsRepository {
  return getPlatformServices().namespaceSecretsRepo;
}

async function requireNamespaceMember(namespace: string, userId: string): Promise<void> {
  const { namespaceRepo } = getPlatformServices();

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

export interface NamespaceOpenRouterCredits {
  available: boolean;
  limit: number;
  usage: number;
  remaining: number;
  error?: string;
}

export async function getOpenRouterCredits(
  namespace: string,
  userId: string,
): Promise<NamespaceOpenRouterCredits> {
  await requireNamespaceMember(namespace, userId);

  const secrets = await getRepo().getSecrets(namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];
  if (!apiKey) {
    return { available: false, limit: 0, usage: 0, remaining: 0, error: 'OPENROUTER_API_KEY not configured in workspace secrets' };
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 60 },
    });

    if (!res.ok) {
      return { available: false, limit: 0, usage: 0, remaining: 0, error: `OpenRouter returned ${res.status}` };
    }

    const body = await res.json() as { data?: { limit?: number; usage?: number; limit_remaining?: number } };
    const data = body?.data;
    if (!data || typeof data.limit_remaining !== 'number') {
      return { available: false, limit: 0, usage: 0, remaining: 0, error: 'Unexpected response shape from OpenRouter' };
    }
    return { available: true, limit: data.limit ?? 0, usage: data.usage ?? 0, remaining: data.limit_remaining };
  } catch (err: unknown) {
    return { available: false, limit: 0, usage: 0, remaining: 0, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

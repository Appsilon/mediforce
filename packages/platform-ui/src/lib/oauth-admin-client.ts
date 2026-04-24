import { apiFetch } from './api-fetch';
import type {
  OAuthProviderConfig,
  CreateOAuthProviderInput,
  UpdateOAuthProviderInput,
} from '@mediforce/platform-core';

/** Thin wrappers over `/api/admin/oauth-providers`. All calls attach the
 *  Firebase ID token via `apiFetch`. Provider admin surface is gated on
 *  namespace `owner | admin` role at the page level; this client does not
 *  short-circuit permission checks. */

async function parseOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${label} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listOAuthProviders(namespace: string): Promise<OAuthProviderConfig[]> {
  const res = await apiFetch(
    `/api/admin/oauth-providers?namespace=${encodeURIComponent(namespace)}`,
  );
  const { providers } = await parseOrThrow<{ providers: OAuthProviderConfig[] }>(
    res,
    'List OAuth providers',
  );
  return providers;
}

export async function getOAuthProvider(
  namespace: string,
  id: string,
): Promise<OAuthProviderConfig> {
  const res = await apiFetch(
    `/api/admin/oauth-providers/${encodeURIComponent(id)}?namespace=${encodeURIComponent(namespace)}`,
  );
  const { provider } = await parseOrThrow<{ provider: OAuthProviderConfig }>(
    res,
    'Get OAuth provider',
  );
  return provider;
}

export async function createOAuthProvider(
  namespace: string,
  input: CreateOAuthProviderInput,
): Promise<OAuthProviderConfig> {
  const res = await apiFetch(
    `/api/admin/oauth-providers?namespace=${encodeURIComponent(namespace)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  );
  const { provider } = await parseOrThrow<{ provider: OAuthProviderConfig }>(
    res,
    'Create OAuth provider',
  );
  return provider;
}

export async function updateOAuthProvider(
  namespace: string,
  id: string,
  patch: UpdateOAuthProviderInput,
): Promise<OAuthProviderConfig> {
  const res = await apiFetch(
    `/api/admin/oauth-providers/${encodeURIComponent(id)}?namespace=${encodeURIComponent(namespace)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  const { provider } = await parseOrThrow<{ provider: OAuthProviderConfig }>(
    res,
    'Update OAuth provider',
  );
  return provider;
}

export async function deleteOAuthProvider(namespace: string, id: string): Promise<void> {
  const res = await apiFetch(
    `/api/admin/oauth-providers/${encodeURIComponent(id)}?namespace=${encodeURIComponent(namespace)}`,
    { method: 'DELETE' },
  );
  await parseOrThrow<{ success: true }>(res, 'Delete OAuth provider');
}

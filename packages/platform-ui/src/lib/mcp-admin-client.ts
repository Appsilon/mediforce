import { apiFetch } from './api-fetch';
import type { ToolCatalogEntry } from '@mediforce/platform-core';

/**
 * Thin typed wrappers over the `/api/admin/tool-catalog` REST surface.
 * All calls attach the Firebase ID token via `apiFetch`.
 *
 * When #232's generated API client lands, this module becomes a mechanical
 * re-export of those clients — keep the call sites going through these helpers.
 */

async function parseOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${label} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

function withNamespace(path: string, namespace: string): string {
  const qs = new URLSearchParams({ namespace }).toString();
  return path.includes('?') ? `${path}&${qs}` : `${path}?${qs}`;
}

export async function listCatalogEntries(namespace: string): Promise<ToolCatalogEntry[]> {
  const res = await apiFetch(withNamespace('/api/admin/tool-catalog', namespace));
  const { entries } = await parseOrThrow<{ entries: ToolCatalogEntry[] }>(res, 'List catalog');
  return entries;
}

export async function getCatalogEntry(namespace: string, id: string): Promise<ToolCatalogEntry | null> {
  const res = await apiFetch(withNamespace(`/api/admin/tool-catalog/${encodeURIComponent(id)}`, namespace));
  if (res.status === 404) return null;
  const { entry } = await parseOrThrow<{ entry: ToolCatalogEntry }>(res, 'Get catalog entry');
  return entry;
}

export type CreateCatalogEntryPayload = Omit<ToolCatalogEntry, 'id'> & { id?: string };

export async function createCatalogEntry(
  namespace: string,
  payload: CreateCatalogEntryPayload,
): Promise<ToolCatalogEntry> {
  const res = await apiFetch(withNamespace('/api/admin/tool-catalog', namespace), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const { entry } = await parseOrThrow<{ entry: ToolCatalogEntry }>(res, 'Create catalog entry');
  return entry;
}

export type UpdateCatalogEntryPayload = Partial<Omit<ToolCatalogEntry, 'id'>>;

export async function updateCatalogEntry(
  namespace: string,
  id: string,
  payload: UpdateCatalogEntryPayload,
): Promise<ToolCatalogEntry> {
  const res = await apiFetch(withNamespace(`/api/admin/tool-catalog/${encodeURIComponent(id)}`, namespace), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const { entry } = await parseOrThrow<{ entry: ToolCatalogEntry }>(res, 'Update catalog entry');
  return entry;
}

export async function deleteCatalogEntry(namespace: string, id: string): Promise<void> {
  const res = await apiFetch(withNamespace(`/api/admin/tool-catalog/${encodeURIComponent(id)}`, namespace), {
    method: 'DELETE',
  });
  await parseOrThrow<{ success: true }>(res, 'Delete catalog entry');
}

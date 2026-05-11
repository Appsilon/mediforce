import { apiFetch } from './api-fetch';
import type {
  CreateSkillRegistryInput,
  SkillRegistry,
  UpdateSkillRegistryInput,
} from '@mediforce/platform-core';

/**
 * Thin typed wrappers over the `/api/skill-registries` REST surface.
 * All calls attach the Firebase ID token via `apiFetch`.
 */

async function parseOrThrow<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `${label} failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function listSkillRegistries(): Promise<SkillRegistry[]> {
  const res = await apiFetch('/api/skill-registries');
  const { skillRegistries } = await parseOrThrow<{ skillRegistries: SkillRegistry[] }>(
    res,
    'List skill registries',
  );
  return skillRegistries;
}

export async function getSkillRegistry(id: string): Promise<SkillRegistry | null> {
  const res = await apiFetch(`/api/skill-registries/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  const { skillRegistry } = await parseOrThrow<{ skillRegistry: SkillRegistry }>(
    res,
    'Get skill registry',
  );
  return skillRegistry;
}

export async function createSkillRegistry(
  payload: CreateSkillRegistryInput,
): Promise<SkillRegistry> {
  const res = await apiFetch('/api/skill-registries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const { skillRegistry } = await parseOrThrow<{ skillRegistry: SkillRegistry }>(
    res,
    'Create skill registry',
  );
  return skillRegistry;
}

export async function updateSkillRegistry(
  id: string,
  payload: UpdateSkillRegistryInput,
): Promise<SkillRegistry> {
  const res = await apiFetch(`/api/skill-registries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const { skillRegistry } = await parseOrThrow<{ skillRegistry: SkillRegistry }>(
    res,
    'Update skill registry',
  );
  return skillRegistry;
}

export async function deleteSkillRegistry(id: string): Promise<void> {
  const res = await apiFetch(`/api/skill-registries/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  await parseOrThrow<{ success: true }>(res, 'Delete skill registry');
}

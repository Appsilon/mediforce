'use server';

import {
  getAdminFirestore,
  FirestoreNamespaceSecretsRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  getPlatformServices();
  return new FirestoreNamespaceSecretsRepository(getAdminFirestore());
}

/**
 * Server-internal: runtime secret resolution called from step execution.
 * Not browser-callable in practice — no user auth check because the caller
 * is the workflow engine acting as the system actor. Out of Phase 2.5 scope
 * (the headless migration retires the user-facing entries; runtime helpers
 * stay as regular server-side functions until the agent-runtime split lands).
 */
export async function getNamespaceSecretsForRuntime(
  namespace: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace);
}

'use server';

import { getPlatformServices } from '@/lib/platform-services';

// Runtime secret resolution for step execution. No user auth check: the
// caller is the workflow engine (system actor), not a browser request.
// Read mutations migrated to headless handlers (Phase 2.5); this thin
// runtime-only entry point survives because workflow steps still call it
// directly from server code paths.
export async function getNamespaceSecretsForRuntime(
  namespace: string,
): Promise<Record<string, string>> {
  return getPlatformServices().namespaceSecretsRepo.getSecrets(namespace);
}

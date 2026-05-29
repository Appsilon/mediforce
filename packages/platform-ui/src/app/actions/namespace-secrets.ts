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

// Runtime secret resolution for step execution. No user auth check: the
// caller is the workflow engine (system actor), not a browser request.
export async function getNamespaceSecretsForRuntime(
  namespace: string,
): Promise<Record<string, string>> {
  return getRepo().getSecrets(namespace);
}

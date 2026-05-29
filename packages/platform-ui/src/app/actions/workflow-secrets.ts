'use server';

import {
  getAdminFirestore,
  FirestoreWorkflowSecretsRepository,
} from '@mediforce/platform-infra';
import { getPlatformServices } from '@/lib/platform-services';

function getRepo() {
  getPlatformServices();
  return new FirestoreWorkflowSecretsRepository(getAdminFirestore());
}

/** Get secrets for runtime resolution (called server-side from execute-agent-step — no user auth needed) */
export const getWorkflowSecretsForRuntime = async (
  namespace: string,
  workflowName: string,
): Promise<Record<string, string>> => getRepo().getSecrets(namespace, workflowName);

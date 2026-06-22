'use server';

import { getPlatformServices } from '@/lib/platform-services';

/** Get secrets for runtime resolution (called server-side from
 *  execute-agent-step — no user auth needed). Read/mutation flows
 *  migrated to headless handlers (Phase 2.5); this thin runtime-only
 *  entry point survives because workflow steps still call it directly
 *  from server code paths. */
export const getWorkflowSecretsForRuntime = async (
  namespace: string,
  workflowName: string,
): Promise<Record<string, string>> => getPlatformServices().secretsRepo.getSecrets(namespace, workflowName);

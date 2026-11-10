import {
  resolveMaxOutputTokens,
  type ModelRegistryRepository,
  type NamespaceRepository,
} from '@mediforce/platform-core';

interface OutputTokenSources {
  workspaces: Pick<NamespaceRepository, 'getNamespace' | 'getMember'>;
  models: Pick<ModelRegistryRepository, 'getById'>;
}

interface OutputTokenRequest {
  namespace: string | null | undefined;
  model: string;
  defaultTokens: number;
  /** For a call that has always been capped at the model's limit, at every budget. */
  capAtModelLimit?: boolean;
  /** The person making the call, whose own budget applies; null for an apiKey or system caller. */
  userId: string | null;
}

/**
 * Max output tokens for one platform LLM call: the call's default scaled by the
 * caller's own output budget, or the workspace's when they have none, within the model's
 * limit (see `resolveMaxOutputTokens`).
 */
export async function resolveOutputTokens(sources: OutputTokenSources, request: OutputTokenRequest): Promise<number> {
  const handle = request.namespace ?? '';
  const [workspace, member, entry] = await Promise.all([
    handle === '' ? null : sources.workspaces.getNamespace(handle),
    handle === '' || request.userId === null ? null : sources.workspaces.getMember(handle, request.userId),
    sources.models.getById(request.model),
  ]);
  return resolveMaxOutputTokens({
    defaultTokens: request.defaultTokens,
    workspaceBudget: workspace?.outputBudget,
    memberBudget: member?.outputBudget,
    modelMaxCompletionTokens: entry?.maxCompletionTokens,
    capAtModelLimit: request.capAtModelLimit,
  });
}

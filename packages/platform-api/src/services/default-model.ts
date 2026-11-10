import {
  DEFAULT_MODEL,
  effectiveDefaultModel,
  isUsableDefaultModel,
  type ModelRegistryRepository,
  type NamespaceRepository,
} from '@mediforce/platform-core';

interface DefaultModelSources {
  workspaces: Pick<NamespaceRepository, 'getNamespace' | 'getMember'>;
  models: Pick<ModelRegistryRepository, 'getById'>;
}

interface DefaultModelRequest {
  namespace: string | null | undefined;
  /** The person making the call, whose own default applies; null for an apiKey or system caller. */
  userId: string | null;
}

/** The caller's own default model, else the workspace's; undefined when neither is set. */
export async function preferredDefaultModel(
  sources: Pick<DefaultModelSources, 'workspaces'>,
  request: DefaultModelRequest,
): Promise<string | undefined> {
  const handle = request.namespace ?? '';
  if (handle === '') return undefined;
  const [workspace, member] = await Promise.all([
    sources.workspaces.getNamespace(handle),
    request.userId === null ? null : sources.workspaces.getMember(handle, request.userId),
  ]);
  return effectiveDefaultModel(workspace?.defaultModel, member?.defaultModel);
}

/**
 * The model for a platform LLM call nobody saved a model for: the preferred
 * default, else `DEFAULT_MODEL`. A default the registry no longer lists live,
 * or that cannot call tools, falls back to `DEFAULT_MODEL`, so it never breaks a call.
 */
export async function resolveDefaultModel(sources: DefaultModelSources, request: DefaultModelRequest): Promise<string> {
  const preferred = await preferredDefaultModel(sources, request);
  if (preferred === undefined) return DEFAULT_MODEL;
  const entry = await sources.models.getById(preferred);
  return isUsableDefaultModel(entry) ? preferred : DEFAULT_MODEL;
}

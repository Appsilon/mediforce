import {
  DEFAULT_MODEL,
  effectiveModelSettings,
  isUsableDefaultModel,
  pinDefaultModel,
  resolveMaxOutputTokens,
  type ModelRegistryRepository,
  type NamespaceRepository,
  type OutputBudget,
} from '@mediforce/platform-core';

type Models = Pick<ModelRegistryRepository, 'getById' | 'list'>;

/** What one caller's calls in one workspace get: each of their own settings, else the workspace's. */
export interface ModelSettings {
  readonly outputBudget: OutputBudget;
  readonly defaultModel: string | undefined;
}

/**
 * Loads a caller's model settings once per request or step. `userId` is the
 * person behind the call (`callerUserId`); null for an apiKey or system caller,
 * who gets the workspace's.
 */
export async function loadModelSettings(
  workspaces: Pick<NamespaceRepository, 'getNamespace' | 'getMember'>,
  request: { namespace: string | null | undefined; userId: string | null },
): Promise<ModelSettings> {
  const handle = request.namespace ?? '';
  if (handle === '') return effectiveModelSettings(null, null);
  const [workspace, member] = await Promise.all([
    workspaces.getNamespace(handle),
    request.userId === null ? null : workspaces.getMember(handle, request.userId),
  ]);
  return effectiveModelSettings(workspace, member);
}

/**
 * The model for a platform LLM call nobody saved a model for: the settings'
 * default model while `isUsableDefaultModel` holds for it, else `DEFAULT_MODEL`,
 * so a retired or tool-less choice never breaks a call.
 */
export async function resolveDefaultModel(models: Models, settings: ModelSettings): Promise<string> {
  if (settings.defaultModel === undefined) return DEFAULT_MODEL;
  return isUsableDefaultModel(await models.getById(settings.defaultModel)) ? settings.defaultModel : DEFAULT_MODEL;
}

/**
 * Max output tokens for one platform LLM call: the call's default scaled by the
 * settings' output budget, within the model's limit (see `resolveMaxOutputTokens`).
 */
export async function resolveOutputTokens(
  models: Models,
  settings: ModelSettings,
  request: { model: string; defaultTokens: number; capAtModelLimit?: boolean; raiseOnly?: boolean },
): Promise<number> {
  // The registry lists no aliases, so the platform default's limits are its pinned model's.
  const limitModel = request.model === DEFAULT_MODEL ? pinDefaultModel(await models.list()) : request.model;
  const entry = await models.getById(limitModel);
  return resolveMaxOutputTokens({
    defaultTokens: request.defaultTokens,
    budget: settings.outputBudget,
    modelMaxCompletionTokens: entry?.maxCompletionTokens,
    capAtModelLimit: request.capAtModelLimit,
    raiseOnly: request.raiseOnly,
  });
}

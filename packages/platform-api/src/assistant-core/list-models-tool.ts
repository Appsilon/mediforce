import type { CallerScope } from '../repositories/index';

export const LIST_MODELS_TOOL_NAME = 'list_models';

/** The cheapest live models first, capped so the list fits a turn. */
export async function runListModelsTool(scope: CallerScope): Promise<unknown> {
  const models = await scope.models.list();
  return models
    .filter((model) => model.retiredAt === null)
    .sort((left, right) => (left.pricing.input + left.pricing.output) - (right.pricing.input + right.pricing.output))
    .slice(0, 40)
    .map((model) => ({
      id: model.id,
      name: model.name,
      contextLength: model.contextLength,
      inputPricePerToken: model.pricing.input,
      outputPricePerToken: model.pricing.output,
      supportsTools: model.supportsTools,
      supportsVision: model.supportsVision,
    }));
}

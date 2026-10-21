import type { StepParam } from '../schemas/process-definition';
import { interpolate, resolvesFully, runInterpolationSources, type RunInterpolationContext } from '../interpolation';

// Widgets that edit the value itself; every other type renders a text input that needs a string.
const STRUCTURED_PARAM_TYPES = new Set(['boolean', 'number', 'multiselect', 'object']);

// Renders `${steps.*}` / `${triggerPayload.*}` in each param's default against the run, so the task's form opens on the real draft.
export function resolveParamDefaults(params: StepParam[], run: RunInterpolationContext | null): StepParam[] {
  const sources = runInterpolationSources(run);
  return params.map((param) => {
    const { default: template, ...rest } = param;
    if (typeof template !== 'string' || template.includes('${') === false) return param;
    if (resolvesFully(template, sources) === false) return rest;
    const resolved = interpolate(template, sources);
    const isTextField = STRUCTURED_PARAM_TYPES.has(param.type) === false;
    if (isTextField === true && typeof resolved !== 'string') {
      return { ...rest, default: JSON.stringify(resolved, null, 2) };
    }
    return { ...rest, default: resolved };
  });
}

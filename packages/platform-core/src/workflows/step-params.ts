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

export class UnresolvedStepParamError extends Error {
  constructor(readonly references: string[]) {
    super(`stepParams reference values this run does not have: ${references.join(', ')}`);
    this.name = 'UnresolvedStepParamError';
  }
}

export interface ResolvedStepParams {
  // Literal values: defaults the step's input overrides.
  defaults: Record<string, unknown>;
  // Values that held `${…}`, rendered against the run: mappings the author named, which win over the step's input.
  mappings: Record<string, unknown>;
}

// Renders `${steps.*}` / `${triggerPayload.*}` in an agent step's stepParams against the run, so a step can hand its Agent a flat input.
// A reference that names nothing fails the step instead of reaching the Agent as a literal `${…}`; secrets are withheld, as the input is audited.
export function resolveStepParams(stepParams: Record<string, unknown>, run: RunInterpolationContext | null): ResolvedStepParams {
  const sources = runInterpolationSources(run);
  const defaults: Record<string, unknown> = {};
  const mappings: Record<string, unknown> = {};
  const unresolved: string[] = [];
  for (const [name, value] of Object.entries(stepParams)) {
    const placeholders = templateStrings(value).flatMap((template) => [...template.matchAll(/\$\{[^}]+\}/g)].map(([placeholder]) => placeholder));
    if (placeholders.length === 0) {
      defaults[name] = value;
      continue;
    }
    unresolved.push(...placeholders.filter((placeholder) => interpolate(placeholder, sources) === undefined));
    mappings[name] = interpolate(value, sources);
  }
  if (unresolved.length > 0) throw new UnresolvedStepParamError([...new Set(unresolved)]);
  return { defaults, mappings };
}

function templateStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.includes('${') ? [value] : [];
  if (Array.isArray(value)) return value.flatMap(templateStrings);
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(templateStrings);
  return [];
}

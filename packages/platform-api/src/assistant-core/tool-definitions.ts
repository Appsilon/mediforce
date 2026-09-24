import { z } from 'zod';
import type { OpenRouterToolDefinition } from '../services/openrouter-client';

/** A Zod tool registry as the function definitions the model is offered. */
export function toolDefinitions(tools: Readonly<Record<string, z.ZodType>>): OpenRouterToolDefinition[] {
  return Object.entries(tools).map(([name, schema]) => ({
    type: 'function',
    function: { name, parameters: z.toJSONSchema(schema, { io: 'input' }) },
  }));
}

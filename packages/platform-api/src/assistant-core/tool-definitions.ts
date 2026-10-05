import { z } from 'zod';
import type { OpenRouterToolDefinition } from '../services/openrouter-client';

type JsonSchemaNode = z.core.JSONSchema.BaseSchema;

function isObjectSchema(node: JsonSchemaNode | boolean): boolean {
  return typeof node === 'object' && node.type === 'object';
}

/**
 * A tool's arguments as JSON Schema. A union of objects (a discriminated
 * `check`) is typed `object` too: a property with only `oneOf` / `anyOf` and
 * no `type` is one a model tends to send as a JSON-encoded string.
 */
export function toolParameters(schema: z.ZodType): JsonSchemaNode {
  return z.toJSONSchema(schema, {
    io: 'input',
    override: ({ jsonSchema }) => {
      const branches = jsonSchema.oneOf ?? jsonSchema.anyOf;
      if (jsonSchema.type === undefined && branches !== undefined && branches.length > 0 && branches.every(isObjectSchema)) {
        jsonSchema.type = 'object';
      }
    },
  });
}

/** A Zod tool registry as the function definitions the model is offered. */
export function toolDefinitions(tools: Readonly<Record<string, z.ZodType>>): OpenRouterToolDefinition[] {
  return Object.entries(tools).map(([name, schema]) => ({
    type: 'function',
    function: { name, parameters: toolParameters(schema) },
  }));
}

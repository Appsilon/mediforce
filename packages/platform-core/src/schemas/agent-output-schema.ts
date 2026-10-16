import { z } from 'zod';

/**
 * JSON Schema an agent's `result` must satisfy — declared by an Agent or by the
 * Step that runs it. The same structural subset cowork enforces (`type`,
 * `required`, per-property `type`); other keywords pass through to the prompt
 * as guidance but are not checked.
 */
export const OutputSchemaPropertyTypeSchema = z.enum(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object']);

export const AgentOutputSchemaSchema = z.looseObject({
  type: z.literal('object').optional(),
  required: z.array(z.string()).optional(),
  properties: z.record(z.string(), z.looseObject({ type: OutputSchemaPropertyTypeSchema.optional() })).optional(),
});

export type AgentOutputSchema = z.infer<typeof AgentOutputSchemaSchema>;
export type OutputSchemaPropertyType = z.infer<typeof OutputSchemaPropertyTypeSchema>;

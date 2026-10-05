import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { EVALUATION_ASSISTANT_PLATFORM_TOOLS, EVALUATION_ASSISTANT_PROPOSAL_TOOLS } from '@mediforce/platform-core';
import { toolDefinitions, toolParameters } from '../tool-definitions';

const CheckSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('schema'), schema: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('code'), source: z.string() }),
]);

describe('toolDefinitions', () => {
  it('types a union of objects as an object, so the model does not send it as a string', () => {
    const [definition] = toolDefinitions({ propose_evaluator: z.object({ check: CheckSchema, note: z.union([z.string(), z.number()]) }) });
    const parameters = definition!.function.parameters as { properties: Record<string, Record<string, unknown>> };

    expect(parameters.properties.check).toMatchObject({ type: 'object', oneOf: expect.any(Array) });
    expect(parameters.properties.note!.type).toBeUndefined();
  });

  it('offers the Evaluation Assistant\'s check as an object in the tools that draft one', () => {
    const offered = toolDefinitions({
      propose_evaluator: EVALUATION_ASSISTANT_PROPOSAL_TOOLS.propose_evaluator,
      preview_evaluator: EVALUATION_ASSISTANT_PLATFORM_TOOLS.preview_evaluator,
    });
    for (const definition of offered) {
      expect(definition.function.parameters).toMatchObject({ properties: { check: { type: 'object' } } });
    }
  });

  it('gives a validation error the same parameters the model was offered', () => {
    expect(toolParameters(z.object({ check: CheckSchema }))).toMatchObject({ properties: { check: { type: 'object' } } });
  });
});

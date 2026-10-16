import { z } from 'zod';
import {
  OutputSchemaPropertyTypeSchema,
  type OutputSchemaPropertyType,
  type OutputSchemaShape,
} from '@mediforce/platform-core';
import type { LlmClient, LlmMessage } from '../interfaces/step-executor-plugin';
import { parseAnswer } from './llm-answer';

const TYPE_CHECKS: Record<OutputSchemaPropertyType, (value: unknown) => boolean> = {
  string: (value) => typeof value === 'string',
  number: (value) => typeof value === 'number',
  integer: (value) => Number.isInteger(value),
  boolean: (value) => typeof value === 'boolean',
  null: (value) => value === null,
  array: (value) => Array.isArray(value),
  object: (value) => typeof value === 'object' && value !== null && Array.isArray(value) === false,
};

function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Checks an output against the structural JSON Schema subset shared by cowork
 *  artifacts and `agent.outputSchema`. Returns the first violation, or `null`. */
export function validateOutputSchema(
  output: Record<string, unknown>,
  schema: OutputSchemaShape,
): string | null {
  let data = output;

  if ('raw' in output && typeof output.raw === 'string' && Object.keys(output).length === 1) {
    try {
      const parsed = JSON.parse(output.raw);
      if (Array.isArray(parsed)) return 'expected object, got array';
      if (typeof parsed !== 'object' || parsed === null) return 'output is not valid JSON';
      data = parsed as Record<string, unknown>;
    } catch {
      return 'output is not valid JSON';
    }
  }

  if (Object.keys(data).length === 0
    || (Object.keys(data).length === 1 && 'raw' in data && (data.raw === '' || data.raw == null))) {
    return 'output is empty';
  }

  const required = schema.required ?? [];
  const missing = required.filter((key) => !(key in data));
  if (missing.length > 0) return `missing required keys: ${missing.join(', ')}`;

  const properties = schema.properties ?? {};
  for (const [key, spec] of Object.entries(properties)) {
    if (!(key in data)) continue;
    // Cowork's looser schema can name a type outside the subset; it goes unchecked.
    const expectedType = OutputSchemaPropertyTypeSchema.safeParse(spec.type);
    if (expectedType.success === false) continue;

    const value = data[key];
    if (TYPE_CHECKS[expectedType.data](value) === false) {
      return `property "${key}" expected ${expectedType.data}, got ${jsonTypeOf(value)}`;
    }
  }

  return null;
}

type Leaf = string | number | boolean;

function leavesOf(value: unknown): Leaf[] {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [value];
  if (Array.isArray(value)) return value.flatMap(leavesOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(leavesOf);
  return [];
}

/**
 * The values of a reshaped result the original never states, as JSON: a
 * string must appear inside one of the original's strings, a number or boolean
 * must be one of its values or be written in one of its strings. What the
 * repair prompt asks for, checked rather than trusted.
 */
function introducedValues(original: Record<string, unknown>, repaired: Record<string, unknown>): string[] {
  const originalLeaves = leavesOf(original);
  const originalTexts = originalLeaves.map((leaf) => String(leaf).toLowerCase());
  const stated = (leaf: Leaf) => {
    if (typeof leaf === 'string') return originalTexts.some((text) => text.includes(leaf.toLowerCase()));
    if (originalLeaves.includes(leaf)) return true;
    const written = new RegExp(`(^|[^\\w.])${String(leaf).replace('.', '\\.')}($|[^\\w])`, 'i');
    return originalTexts.some((text) => written.test(text));
  };
  return leavesOf(repaired).filter((leaf) => stated(leaf) === false).map((leaf) => JSON.stringify(leaf));
}

/**
 * What the model that reshapes a result is sent: the schema, the violation
 * and the rejected result, with the rule that it may only rearrange what the
 * result already says — a key it cannot fill from there stays missing, so the
 * reshaped result fails validation instead of carrying an invented value.
 */
export function outputRepairMessages(
  result: Record<string, unknown>,
  schema: OutputSchemaShape,
  violation: string,
): LlmMessage[] {
  return [
    {
      role: 'system',
      content: [
        'An AI agent in a pharmaceutical workflow returned a JSON result that was rejected because it does not match the JSON Schema its step requires.',
        `Why it was rejected: ${violation}`,
        [
          'Return the same result reshaped to match the schema. Only rename, move or restructure keys,',
          'convert a value to the type the schema names, or copy a value the result states word for word.',
          'Never invent, infer, summarise or reword findings, values or judgments:',
          'if a required key cannot be filled with a value the result states, leave it out.',
          'Keep every other key and value as it is.',
        ].join(' '),
        'Answer with the corrected JSON object and nothing else.',
      ].join('\n\n'),
    },
    {
      role: 'user',
      content: [
        `JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
        `Rejected result:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
      ].join('\n\n'),
    },
  ];
}

export type OutputRepair =
  | { ok: true; result: Record<string, unknown>; model: string }
  | { ok: false; reason: string };

/**
 * Reshapes a result that broke `agent.outputSchema` with one LLM call instead
 * of rerunning the agent (ADR-0023 D13), then validates it again and checks it
 * carries no value the result did not state. `ok: false` says why the result
 * still cannot be used.
 */
export async function repairOutput(
  llm: LlmClient,
  model: string,
  result: Record<string, unknown>,
  schema: OutputSchemaShape,
  violation: string,
): Promise<OutputRepair> {
  let content: string;
  let answeredBy: string;
  try {
    const response = await llm.complete(outputRepairMessages(result, schema, violation), model);
    content = response.content;
    answeredBy = response.model;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
  const repaired = parseAnswer(content, z.record(z.string(), z.unknown()));
  if (repaired === null) return { ok: false, reason: 'the answer was not a JSON object' };
  const remaining = validateOutputSchema(repaired, schema);
  if (remaining !== null) return { ok: false, reason: remaining };
  const introduced = introducedValues(result, repaired);
  if (introduced.length > 0) {
    return { ok: false, reason: `it introduced values the result does not contain: ${introduced.join(', ')}` };
  }
  return { ok: true, result: repaired, model: answeredBy };
}

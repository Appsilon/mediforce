import { z } from 'zod';
import { WorkflowDefinitionBaseSchema } from '@mediforce/platform-core';

/**
 * Fields the platform injects at registration (`namespace`, `version`) or
 * manages itself (`createdAt`). The design step must not ask the human/agent to
 * produce them — this mirrors the omit set of `WorkflowTemplateSchema` and the
 * `parseWorkflowDefinitionForCreation` registration contract.
 */
const SERVER_MANAGED_FIELDS = {
  namespace: true,
  version: true,
  createdAt: true,
} as const;

/** The authorable surface of a WorkflowDefinition the cowork design step builds. */
const WorkflowDesignerArtifactSchema = WorkflowDefinitionBaseSchema.omit(
  SERVER_MANAGED_FIELDS,
);

/** The shallow `{ type, required, properties }` JSON Schema that cowork artifact
 *  validation understands (single top-level `type` per property). */
export interface CoworkOutputSchema {
  type: 'object';
  required: string[];
  properties: Record<string, { type?: string }>;
}

/**
 * Derive the design step's `cowork.outputSchema` from the live Zod schema.
 *
 * Only the **voice** designer bakes this in: the voice realtime/synthesis path
 * reads `session.outputSchema` directly and cannot consume previous-step
 * context, so it needs a schema embedded in the definition. The chat designer
 * instead fetches the live schema at run time via its `fetch-schema` step (see
 * `GET /api/workflow-definitions/schema`), so it bakes nothing.
 *
 * The committed `voice-workflow-designer.wd.json` embeds a generated copy and
 * `output-schema.test.ts` fails if it drifts. Regenerate with
 * `pnpm --filter @mediforce/workflow-designer sync-schema`.
 *
 * Uses Zod's native JSON Schema export in `'input'` mode so fields carrying a
 * `.default()` (e.g. `visibility`) are reported as optional — the design step
 * produces the input shape, not the parsed output.
 */
export function buildWorkflowDesignerOutputSchema(): CoworkOutputSchema {
  const json = z.toJSONSchema(WorkflowDesignerArtifactSchema, { io: 'input' }) as {
    required?: string[];
    properties?: Record<string, { type?: unknown }>;
  };

  const properties: Record<string, { type?: string }> = {};
  for (const [key, spec] of Object.entries(json.properties ?? {})) {
    properties[key] = typeof spec.type === 'string' ? { type: spec.type } : {};
  }

  return { type: 'object', required: json.required ?? [], properties };
}

export const workflowDesignerOutputSchema = buildWorkflowDesignerOutputSchema();

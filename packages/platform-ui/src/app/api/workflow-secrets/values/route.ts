import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkflowSecretsFull, saveWorkflowSecrets } from '@mediforce/platform-api/handlers';
import {
  GetWorkflowSecretsFullInputSchema,
  SaveWorkflowSecretsInputSchema,
  type GetWorkflowSecretsFullInput,
  type SaveWorkflowSecretsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-secrets/values?namespace=…&workflow=…
 *
 * Value-revealing read of workflow-scoped secrets — companion to the
 * key-listing GET on `/api/workflow-secrets`. GET is fine here because the
 * URL itself carries no secret material; the response body does, and TLS
 * covers it. Handler emits an audit event for every reveal.
 *
 * Non-member callers hit `assertNamespaceAccess` and get a `ForbiddenError`,
 * which the adapter maps to 403.
 */
export const GET = createRouteAdapter<typeof GetWorkflowSecretsFullInputSchema, GetWorkflowSecretsFullInput>(
  GetWorkflowSecretsFullInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflow: params.get('workflow') ?? undefined,
    };
  },
  getWorkflowSecretsFull,
);

/**
 * PUT /api/workflow-secrets/values?namespace=…&workflow=…  body: { secrets }
 *
 * Atomic bulk replace. Whole map in, whole map persisted — keys absent from
 * the body get removed. The wrapper's `setSecrets` throws `ForbiddenError`
 * for non-members; the adapter maps that to 403.
 */
export const PUT = createRouteAdapter<typeof SaveWorkflowSecretsInputSchema, SaveWorkflowSecretsInput>(
  SaveWorkflowSecretsInputSchema,
  async (req) => {
    const params = req.nextUrl.searchParams;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // Empty body — Zod will report the missing `secrets` field.
    }
    return {
      namespace: params.get('namespace') ?? undefined,
      workflow: params.get('workflow') ?? undefined,
      ...(typeof body === 'object' && body !== null ? body : {}),
    };
  },
  saveWorkflowSecrets,
);

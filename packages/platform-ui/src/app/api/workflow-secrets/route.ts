import { createRouteAdapter } from '@/lib/route-adapter';
import { listSecretKeys, setSecret, deleteSecret } from '@mediforce/platform-api/handlers';
import {
  ListSecretKeysInputSchema,
  SetSecretInputSchema,
  DeleteSecretInputSchema,
  type ListSecretKeysInput,
  type SetSecretInput,
  type DeleteSecretInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workflow-secrets?namespace=…&workflow=…
 *
 * Lists secret keys (never values). The `scope.workspaceSecrets` /
 * `scope.workflowSecrets` wrappers soft-fail to `[]` for callers outside
 * the workspace — a deliberate change from the legacy 403 (saves the UI
 * from needing a forbidden branch).
 */
export const GET = createRouteAdapter<typeof ListSecretKeysInputSchema, ListSecretKeysInput>(
  ListSecretKeysInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflow: params.get('workflow') ?? undefined,
    };
  },
  listSecretKeys,
);

/**
 * PUT /api/workflow-secrets?namespace=…&workflow=…  body: {key, value}
 *
 * Writes go through the wrapper, which throws `ForbiddenError` for non-
 * members; the adapter maps that to 403.
 */
export const PUT = createRouteAdapter<typeof SetSecretInputSchema, SetSecretInput>(
  SetSecretInputSchema,
  async (req) => {
    const params = req.nextUrl.searchParams;
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      // Empty body — let Zod validation report the missing fields.
    }
    return {
      namespace: params.get('namespace') ?? undefined,
      workflow: params.get('workflow') ?? undefined,
      ...(typeof body === 'object' && body !== null ? body : {}),
    };
  },
  setSecret,
);

/**
 * DELETE /api/workflow-secrets?namespace=…&workflow=…&key=…
 */
export const DELETE = createRouteAdapter<typeof DeleteSecretInputSchema, DeleteSecretInput>(
  DeleteSecretInputSchema,
  (req) => {
    const params = req.nextUrl.searchParams;
    return {
      namespace: params.get('namespace') ?? undefined,
      workflow: params.get('workflow') ?? undefined,
      key: params.get('key') ?? undefined,
    };
  },
  deleteSecret,
);

import { createRouteAdapter } from '@/lib/route-adapter';
import { getWorkspaceSecretPreviews } from '@mediforce/platform-api/handlers';
import {
  GetWorkspaceSecretPreviewsInputSchema,
  type GetWorkspaceSecretPreviewsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/workspace-secrets/previews?namespace=…
 *
 * Workspace secrets editor — masked previews so the operator can verify the
 * stored value before overwriting it. Reveals no plaintext; non-members
 * receive an empty array (anti-enumeration via the wrapper).
 */
export const GET = createRouteAdapter<typeof GetWorkspaceSecretPreviewsInputSchema, GetWorkspaceSecretPreviewsInput>(
  GetWorkspaceSecretPreviewsInputSchema,
  (req) => ({ namespace: req.nextUrl.searchParams.get('namespace') ?? undefined }),
  getWorkspaceSecretPreviews,
);
